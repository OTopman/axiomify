import type { IncomingMessage, ServerResponse } from 'node:http';
import { readBody, sendJson } from '../server/http-server';
import { recordedLogs, notifyLogsUpdated } from './logs';

export interface StudioSpan {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  startTimeMs: number;
  durationMs: number;
  attributes: Record<string, any>;
  status: { code: number; message?: string };
}

export interface StudioTrace {
  traceId: string;
  spans: StudioSpan[];
  startTimeMs: number;
  durationMs: number;
  rootSpan?: StudioSpan;
}

export const recordedSpans: StudioSpan[] = [];
export interface StudioMetricPoint {
  name: string;
  type: 'gauge' | 'sum' | 'histogram' | 'exponentialHistogram' | 'summary';
  value: number;
  timestamp: string;
  attributes: Record<string, unknown>;
}

/** Bounded, process-local OTLP metric store for the Studio Analytics view. */
export const recordedMetrics: StudioMetricPoint[] = [];
let onTracesUpdatedCallback: (() => void) | null = null;

export function setOnTracesUpdated(cb: () => void): void {
  onTracesUpdatedCallback = cb;
}

function notifyTracesUpdated(): void {
  if (onTracesUpdatedCallback) {
    onTracesUpdatedCallback();
  }
}

/**
 * Normalise OTLP attribute value to normal JS primitive.
 */
function parseAttributeValue(val: any): any {
  if (!val || typeof val !== 'object') return val;
  if ('stringValue' in val) return val.stringValue;
  if ('intValue' in val) return Number(val.intValue);
  if ('doubleValue' in val) return Number(val.doubleValue);
  if ('boolValue' in val) return val.boolValue;
  if ('arrayValue' in val) {
    const values = val.arrayValue.values || [];
    return values.map((v: any) => parseAttributeValue(v));
  }
  if ('kvlistValue' in val) {
    const values = val.kvlistValue.values || [];
    const obj: Record<string, any> = {};
    for (const item of values) {
      obj[item.key] = parseAttributeValue(item.value);
    }
    return obj;
  }
  return JSON.stringify(val);
}

/**
 * Convert OTLP key-value attribute array to a normal JS object.
 */
function parseAttributes(attributes: any[]): Record<string, any> {
  const result: Record<string, any> = {};
  if (!Array.isArray(attributes)) return result;
  for (const attr of attributes) {
    if (attr && typeof attr === 'object' && 'key' in attr && 'value' in attr) {
      result[attr.key] = parseAttributeValue(attr.value);
    }
  }
  return result;
}

/**
 * POST /__studio/otlp/v1/traces
 */
export async function handlePostOtlpTraces(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  try {
    const bodyStr = await readBody(req);
    if (!bodyStr) {
      sendJson(res, { success: true });
      return;
    }

    const payload = JSON.parse(bodyStr);
    const resourceSpans = payload.resourceSpans || [];

    for (const resourceSpan of resourceSpans) {
      const scopeSpans = resourceSpan.scopeSpans || [];
      for (const scopeSpan of scopeSpans) {
        const spans = scopeSpan.spans || [];
        for (const span of spans) {
          const startTimeMs = Number(
            BigInt(span.startTimeUnixNano || 0) / 1000000n,
          );
          const endTimeMs = Number(
            BigInt(span.endTimeUnixNano || 0) / 1000000n,
          );
          const durationMs = Math.max(0, endTimeMs - startTimeMs);

          const attributes = parseAttributes(span.attributes);
          const status = {
            code: span.status?.code ?? 0,
            message: span.status?.message,
          };

          recordedSpans.push({
            traceId: span.traceId,
            spanId: span.spanId,
            parentSpanId: span.parentSpanId || undefined,
            name: span.name,
            startTimeMs,
            durationMs,
            attributes,
            status,
          });
        }
      }
    }

    // Bounded traces array (max 1000 spans)
    if (recordedSpans.length > 2000) {
      recordedSpans.splice(0, recordedSpans.length - 2000);
    }

    notifyTracesUpdated();
    sendJson(res, { success: true });
  } catch (err: any) {
    sendJson(
      res,
      { error: 'Failed to process traces', details: err.message },
      500,
    );
  }
}

/**
 * POST /__studio/otlp/v1/metrics
 */
export async function handlePostOtlpMetrics(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  try {
    const bodyStr = await readBody(req);
    if (!bodyStr) {
      sendJson(res, { success: true, accepted: 0 });
      return;
    }
    const payload = JSON.parse(bodyStr);
    let accepted = 0;
    for (const resourceMetric of payload.resourceMetrics ?? []) {
      const resourceAttributes = parseAttributes(
        resourceMetric.resource?.attributes ?? [],
      );
      for (const scopeMetric of resourceMetric.scopeMetrics ?? []) {
        for (const metric of scopeMetric.metrics ?? []) {
          const descriptor = metric.gauge
            ? { type: 'gauge' as const, points: metric.gauge.dataPoints ?? [] }
            : metric.sum
              ? { type: 'sum' as const, points: metric.sum.dataPoints ?? [] }
              : metric.histogram
                ? {
                    type: 'histogram' as const,
                    points: metric.histogram.dataPoints ?? [],
                  }
                : metric.exponentialHistogram
                  ? {
                      type: 'exponentialHistogram' as const,
                      points: metric.exponentialHistogram.dataPoints ?? [],
                    }
                  : metric.summary
                    ? {
                        type: 'summary' as const,
                        points: metric.summary.dataPoints ?? [],
                      }
                    : null;
          if (!descriptor) continue;
          for (const point of descriptor.points) {
            const rawValue =
              descriptor.type === 'histogram' ||
              descriptor.type === 'exponentialHistogram' ||
              descriptor.type === 'summary'
                ? (point.sum ?? point.count)
                : (point.asDouble ?? point.asInt);
            const value = Number(rawValue);
            if (!Number.isFinite(value)) continue;
            const nanos = point.timeUnixNano ?? point.startTimeUnixNano;
            const timestamp = nanos
              ? new Date(Number(BigInt(nanos) / 1000000n)).toISOString()
              : new Date().toISOString();
            recordedMetrics.push({
              name: String(metric.name ?? 'unnamed_metric'),
              type: descriptor.type,
              value,
              timestamp,
              attributes: {
                ...resourceAttributes,
                ...parseAttributes(point.attributes ?? []),
              },
            });
            accepted += 1;
          }
        }
      }
    }
    if (recordedMetrics.length > 2_000) {
      recordedMetrics.splice(0, recordedMetrics.length - 2_000);
    }
    sendJson(res, { success: true, accepted });
  } catch (err: any) {
    sendJson(
      res,
      { error: 'Failed to process metrics', details: err.message },
      500,
    );
  }
}

/** GET /__studio/api/otlp/metrics */
export function handleGetOtlpMetrics(
  _req: IncomingMessage,
  res: ServerResponse,
): void {
  sendJson(res, { metrics: recordedMetrics.slice().reverse() });
}

/** DELETE /__studio/api/otlp/metrics */
export function handleDeleteOtlpMetrics(
  _req: IncomingMessage,
  res: ServerResponse,
): void {
  recordedMetrics.length = 0;
  sendJson(res, { success: true });
}

/**
 * POST /__studio/otlp/v1/logs
 */
export async function handlePostOtlpLogs(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  try {
    const bodyStr = await readBody(req);
    if (!bodyStr) {
      sendJson(res, { success: true });
      return;
    }

    const payload = JSON.parse(bodyStr);
    const resourceLogs = payload.resourceLogs || [];

    for (const resourceLog of resourceLogs) {
      const scopeLogs = resourceLog.scopeLogs || [];
      for (const scopeLog of scopeLogs) {
        const logRecords = scopeLog.logRecords || [];
        for (const record of logRecords) {
          const timestamp = record.timeUnixNano
            ? new Date(
                Number(BigInt(record.timeUnixNano) / 1000000n),
              ).toISOString()
            : new Date().toISOString();

          const attributes = parseAttributes(record.attributes);
          const bodyVal = record.body ? parseAttributeValue(record.body) : '';
          const severityText = (record.severityText || 'INFO').toLowerCase();

          let level: any = 'info';
          if (['warn', 'warning'].some((l) => severityText.includes(l)))
            level = 'warn';
          else if (
            ['error', 'fatal', 'crit'].some((l) => severityText.includes(l))
          )
            level = 'error';
          else if (['debug', 'trace'].some((l) => severityText.includes(l)))
            level = 'debug';

          recordedLogs.push({
            id: `otel-log-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
            level,
            message: String(bodyVal),
            timestamp,
            source: attributes['code.filepath']
              ? `${attributes['code.filepath']}:${attributes['code.lineno'] || 0}`
              : 'otel-logger',
            isInternal: false,
            requestId:
              attributes['request_id'] || attributes['requestId'] || undefined,
            stack: attributes['exception.stacktrace'] || undefined,
          });
        }
      }
    }

    if (recordedLogs.length > 500) {
      recordedLogs.splice(0, recordedLogs.length - 500);
    }

    notifyLogsUpdated();
    sendJson(res, { success: true });
  } catch (err: any) {
    sendJson(
      res,
      { error: 'Failed to process logs', details: err.message },
      500,
    );
  }
}

/**
 * GET /__studio/api/otlp/traces
 */
export function handleGetOtlpTraces(
  _req: IncomingMessage,
  res: ServerResponse,
): void {
  // Group spans by trace ID
  const tracesMap = new Map<string, StudioSpan[]>();
  for (const span of recordedSpans) {
    if (!tracesMap.has(span.traceId)) {
      tracesMap.set(span.traceId, []);
    }
    tracesMap.get(span.traceId)!.push(span);
  }

  const traces: StudioTrace[] = [];
  for (const [traceId, spans] of tracesMap.entries()) {
    // Sort spans by startTime
    spans.sort((a, b) => a.startTimeMs - b.startTimeMs);

    const startTimeMs = spans[0]?.startTimeMs || 0;
    const endTimeMs = Math.max(
      ...spans.map((s) => s.startTimeMs + s.durationMs),
    );
    const durationMs = Math.max(0, endTimeMs - startTimeMs);

    // Root span has no parent, or has the minimum startTime
    const rootSpan = spans.find((s) => !s.parentSpanId) || spans[0];

    traces.push({
      traceId,
      spans,
      startTimeMs,
      durationMs,
      rootSpan,
    });
  }

  // Sort traces: newest first
  traces.sort((a, b) => b.startTimeMs - a.startTimeMs);

  sendJson(res, { traces });
}

/**
 * DELETE /__studio/api/otlp/traces
 */
export function handleDeleteOtlpTraces(
  _req: IncomingMessage,
  res: ServerResponse,
): void {
  recordedSpans.length = 0;
  notifyTracesUpdated();
  sendJson(res, { success: true });
}
