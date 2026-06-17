/**
 * Studio Recorder — Session Store
 *
 * Records all in-flight requests, responses, errors, events, and queries
 * in a unified session, correlated by requestId. Supports full session
 * export in both JSON and HTTP Archive (HAR 1.2) formats.
 *
 * GET  /__studio/api/session          — full session snapshot
 * DELETE /__studio/api/session        — clear and reset session
 * GET  /__studio/api/session/export   — download as JSON
 * GET  /__studio/api/session/har      — download as HAR 1.2
 */
import type { ServerResponse } from 'node:http';
import { sendJson } from '../server/http-server';

function safeStringify(val: any, space?: number): string {
  return JSON.stringify(
    val,
    (_, v) => (typeof v === 'bigint' ? v.toString() : v),
    space,
  );
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface RecordedRequest {
  id: string;
  requestId: string;
  method: string;
  path: string;
  headers: Record<string, string>;
  query: Record<string, string>;
  body: unknown;
  timestamp: string;
}

export interface RecordedResponse {
  id: string;
  requestId: string;
  status: number;
  headers: Record<string, string>;
  body: unknown;
  durationMs: number;
  timestamp: string;
  timeline?: TimelineEntry[];
}

export interface RecordedSessionError {
  id: string;
  requestId: string;
  name: string;
  message: string;
  stack: string;
  method: string;
  path: string;
  timestamp: string;
}

export interface RecordedEvent {
  id: string;
  requestId?: string;
  type: string;
  payload: unknown;
  timestamp: string;
}

export interface RecordedQuery {
  id: string;
  requestId: string;
  query: string;
  durationMs: number;
  failed: boolean;
  timestamp: string;
}

export interface TimelineEntry {
  name: string;
  type: string;
  duration: number;
  before?: any;
  after?: any;
}

export interface FullRecordedEntry {
  requestId: string;
  request: RecordedRequest;
  response?: RecordedResponse;
  errors: RecordedSessionError[];
  queries: RecordedQuery[];
  timeline: TimelineEntry[];
}

// ─── Store ────────────────────────────────────────────────────────────────────

const MAX_ENTRIES = 1000;

const requests: RecordedRequest[] = [];
const responses: RecordedResponse[] = [];
const errors: RecordedSessionError[] = [];
const events: RecordedEvent[] = [];
const queries: RecordedQuery[] = [];

const sessionStartTime = new Date().toISOString();
let entryCount = 0;

function evictIfNeeded<T>(arr: T[]): void {
  if (arr.length > MAX_ENTRIES) {
    arr.splice(0, arr.length - MAX_ENTRIES);
  }
}

// ─── Write API ────────────────────────────────────────────────────────────────

export function recordRequest(entry: Omit<RecordedRequest, 'id'>): void {
  requests.push({ id: `req-${++entryCount}`, ...entry });
  evictIfNeeded(requests);
  notifyRecorderUpdated();
}

export function recordResponse(entry: Omit<RecordedResponse, 'id'>): void {
  responses.push({ id: `res-${++entryCount}`, ...entry });
  evictIfNeeded(responses);
  notifyRecorderUpdated();
}

export function recordSessionError(
  entry: Omit<RecordedSessionError, 'id'>,
): void {
  errors.push({ id: `serr-${++entryCount}`, ...entry });
  evictIfNeeded(errors);
  notifyRecorderUpdated();
}

export function recordEvent(entry: Omit<RecordedEvent, 'id'>): void {
  events.push({ id: `evt-${++entryCount}`, ...entry });
  evictIfNeeded(events);
  notifyRecorderUpdated();
}

export function recordQuery(entry: Omit<RecordedQuery, 'id'>): void {
  queries.push({ id: `qry-${++entryCount}`, ...entry });
  evictIfNeeded(queries);
  notifyRecorderUpdated();
}

// ─── WS Notification ──────────────────────────────────────────────────────────

let onRecorderUpdatedCb: (() => void) | null = null;

export function setOnRecorderUpdated(cb: () => void): void {
  onRecorderUpdatedCb = cb;
}

export function notifyRecorderUpdated(): void {
  onRecorderUpdatedCb?.();
}

// ─── Session Assembly ────────────────────────────────────────────────────────

function buildFullEntries(): FullRecordedEntry[] {
  const byId = new Map<string, FullRecordedEntry>();

  for (const req of requests) {
    byId.set(req.requestId, {
      requestId: req.requestId,
      request: req,
      errors: [],
      queries: [],
      timeline: [],
    });
  }

  for (const res of responses) {
    const entry = byId.get(res.requestId);
    if (entry) {
      entry.response = res;
      if (res.timeline) {
        entry.timeline = res.timeline;
      }
    }
  }

  for (const err of errors) {
    const entry = byId.get(err.requestId);
    if (entry) entry.errors.push(err);
  }

  for (const qry of queries) {
    const entry = byId.get(qry.requestId);
    if (entry) entry.queries.push(qry);
  }

  return Array.from(byId.values()).reverse(); // newest first
}

// ─── HAR 1.2 Export ──────────────────────────────────────────────────────────

function buildHar() {
  const entries = buildFullEntries();
  return {
    log: {
      version: '1.2',
      creator: { name: 'Axiomify Studio', version: '1.0' },
      entries: entries.map((e) => {
        const req = e.request;
        const res = e.response;
        return {
          startedDateTime: req.timestamp,
          time: res?.durationMs ?? 0,
          request: {
            method: req.method,
            url: `http://localhost${req.path}`,
            httpVersion: 'HTTP/1.1',
            cookies: [],
            headers: Object.entries(req.headers || {}).map(([n, v]) => ({
              name: n,
              value: String(v),
            })),
            queryString: Object.entries(req.query || {}).map(([n, v]) => ({
              name: n,
              value: String(v),
            })),
            postData: req.body
              ? {
                  mimeType: 'application/json',
                  text:
                    typeof req.body === 'string'
                      ? req.body
                      : safeStringify(req.body),
                }
              : undefined,
            headersSize: -1,
            bodySize: req.body ? safeStringify(req.body).length : 0,
          },
          response: res
            ? {
                status: res.status,
                statusText: String(res.status),
                httpVersion: 'HTTP/1.1',
                cookies: [],
                headers: Object.entries(res.headers || {}).map(([n, v]) => ({
                  name: n,
                  value: String(v),
                })),
                content: {
                  size: safeStringify(res.body ?? '').length,
                  mimeType: res.headers?.['content-type'] ?? 'application/json',
                  text:
                    typeof res.body === 'string'
                      ? res.body
                      : safeStringify(res.body),
                },
                redirectURL: '',
                headersSize: -1,
                bodySize: -1,
              }
            : {
                status: 0,
                statusText: 'No Response',
                httpVersion: 'HTTP/1.1',
                cookies: [],
                headers: [],
                content: { size: 0, mimeType: 'application/json', text: '' },
                redirectURL: '',
                headersSize: -1,
                bodySize: -1,
              },
          cache: {},
          timings: { send: 0, wait: res?.durationMs ?? 0, receive: 0 },
        };
      }),
    },
  };
}

// ─── HTTP Handlers ────────────────────────────────────────────────────────────

export function handleGetSession(_req: any, res: ServerResponse): void {
  sendJson(res, {
    startedAt: sessionStartTime,
    requests,
    responses,
    errors,
    events,
    queries,
    entries: buildFullEntries(),
    summary: {
      requestCount: requests.length,
      responseCount: responses.length,
      errorCount: errors.length,
      eventCount: events.length,
      queryCount: queries.length,
    },
  });
}

export function handleDeleteSession(_req: any, res: ServerResponse): void {
  requests.length = 0;
  responses.length = 0;
  errors.length = 0;
  events.length = 0;
  queries.length = 0;
  entryCount = 0;
  notifyRecorderUpdated();
  sendJson(res, { success: true });
}

export function handleExportSession(_req: any, res: ServerResponse): void {
  const payload = safeStringify(
    {
      exportedAt: new Date().toISOString(),
      startedAt: sessionStartTime,
      nodeVersion: process.version,
      platform: process.platform,
      requests,
      responses,
      errors,
      events,
      queries,
      entries: buildFullEntries(),
    },
    2,
  );

  res.writeHead(200, {
    'Content-Type': 'application/json',
    'Content-Disposition': `attachment; filename="axiomify-session-${Date.now()}.json"`,
  });
  res.end(payload);
}

export function handleExportHar(_req: any, res: ServerResponse): void {
  const har = buildHar();
  const payload = safeStringify(har, 2);
  res.writeHead(200, {
    'Content-Type': 'application/json',
    'Content-Disposition': `attachment; filename="axiomify-session-${Date.now()}.har"`,
  });
  res.end(payload);
}

export function getSessionData(): {
  requests: RecordedRequest[];
  responses: RecordedResponse[];
  errors: RecordedSessionError[];
  events: RecordedEvent[];
  queries: RecordedQuery[];
  entries: FullRecordedEntry[];
} {
  return {
    requests,
    responses,
    errors,
    events,
    queries,
    entries: buildFullEntries(),
  };
}
