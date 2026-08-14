import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  handlePostOtlpTraces,
  handlePostOtlpLogs,
  handleGetOtlpTraces,
  handleDeleteOtlpTraces,
  handlePostOtlpMetrics,
  handleGetOtlpMetrics,
  handleDeleteOtlpMetrics,
  recordedSpans,
  recordedMetrics,
} from '../../src/studio/api/otlp';
import { recordedLogs } from '../../src/studio/api/logs';

// Helper to mock request body
function mockRequest(bodyObj: any): IncomingMessage {
  const req = {
    on: vi.fn((event, cb) => {
      if (event === 'data') {
        cb(Buffer.from(JSON.stringify(bodyObj)));
      }
      if (event === 'end') {
        cb();
      }
      return req;
    }),
  } as any;
  return req;
}

function mockRawRequest(body: string): IncomingMessage {
  const req = {
    on: vi.fn((event, cb) => {
      if (event === 'data' && body) cb(Buffer.from(body));
      if (event === 'end') cb();
      return req;
    }),
  } as any;
  return req;
}

// Helper to mock response
function mockResponse(): {
  res: ServerResponse;
  getBody: () => any;
  getStatus: () => number;
} {
  let responseStatus = 200;
  let responseBody = '';
  const headers: Record<string, string> = {};

  const res = {
    writeHead(status: number, hdrs: any) {
      responseStatus = status;
      Object.assign(headers, hdrs);
      return res;
    },
    end(body: string) {
      responseBody = body;
    },
  } as any;

  return {
    res,
    getBody: () => (responseBody ? JSON.parse(responseBody) : null),
    getStatus: () => responseStatus,
  };
}

describe('Studio OTLP HTTP/JSON API Receivers', () => {
  beforeEach(() => {
    recordedSpans.length = 0;
    recordedMetrics.length = 0;
    recordedLogs.length = 0;
  });

  it('should parse and record OTLP traces correctly', async () => {
    const mockTracesPayload = {
      resourceSpans: [
        {
          resource: {
            attributes: [
              { key: 'service.name', value: { stringValue: 'test-app' } },
            ],
          },
          scopeSpans: [
            {
              scope: { name: 'axiomify-tracer' },
              spans: [
                {
                  traceId: 'trace_123',
                  spanId: 'span_1',
                  parentSpanId: '',
                  name: 'GET /users',
                  startTimeUnixNano: '1672531199000000000', // 1672531199000 ms
                  endTimeUnixNano: '1672531199050000000', // 1672531199050 ms
                  attributes: [
                    { key: 'http.status_code', value: { intValue: '200' } },
                    { key: 'axiomify.type', value: { stringValue: 'handler' } },
                  ],
                  status: { code: 1 },
                },
                {
                  traceId: 'trace_123',
                  spanId: 'span_2',
                  parentSpanId: 'span_1',
                  name: 'Service Call: db.find',
                  startTimeUnixNano: '1672531199010000000', // 1672531199010 ms
                  endTimeUnixNano: '1672531199040000000', // 1672531199040 ms
                  attributes: [
                    { key: 'axiomify.type', value: { stringValue: 'service' } },
                  ],
                  status: { code: 1 },
                },
              ],
            },
          ],
        },
      ],
    };

    const req = mockRequest(mockTracesPayload);
    const { res, getBody, getStatus } = mockResponse();

    await handlePostOtlpTraces(req, res);

    expect(getStatus()).toBe(200);
    expect(getBody().success).toBe(true);

    expect(recordedSpans.length).toBe(2);
    expect(recordedSpans[0].traceId).toBe('trace_123');
    expect(recordedSpans[0].spanId).toBe('span_1');
    expect(recordedSpans[0].durationMs).toBe(50);
    expect(recordedSpans[0].attributes['http.status_code']).toBe(200);
    expect(recordedSpans[1].parentSpanId).toBe('span_1');
    expect(recordedSpans[1].durationMs).toBe(30);

    // Test GET /__studio/api/otlp/traces
    const { res: getRes, getBody: getTracesBody } = mockResponse();
    handleGetOtlpTraces({} as any, getRes);

    const traces = getTracesBody().traces;
    expect(traces.length).toBe(1);
    expect(traces[0].traceId).toBe('trace_123');
    expect(traces[0].durationMs).toBe(50);
    expect(traces[0].spans.length).toBe(2);
    expect(traces[0].rootSpan?.spanId).toBe('span_1');
  });

  it('should parse and merge OTLP logs into recordedLogs correctly', async () => {
    const mockLogsPayload = {
      resourceLogs: [
        {
          resource: {
            attributes: [
              { key: 'service.name', value: { stringValue: 'test-app' } },
            ],
          },
          scopeLogs: [
            {
              scope: { name: 'axiomify-logger' },
              logRecords: [
                {
                  timeUnixNano: '1672531199000000000',
                  severityText: 'ERROR',
                  severityNumber: 17,
                  body: { stringValue: 'Database connection failed' },
                  attributes: [
                    { key: 'request_id', value: { stringValue: 'req_abc' } },
                    {
                      key: 'exception.stacktrace',
                      value: {
                        stringValue:
                          'Error: Database connection failed\n at ...',
                      },
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };

    const req = mockRequest(mockLogsPayload);
    const { res, getStatus } = mockResponse();

    await handlePostOtlpLogs(req, res);

    expect(getStatus()).toBe(200);
    expect(recordedLogs.length).toBe(1);
    expect(recordedLogs[0].level).toBe('error');
    expect(recordedLogs[0].message).toBe('Database connection failed');
    expect(recordedLogs[0].requestId).toBe('req_abc');
    expect(recordedLogs[0].stack).toBe(
      'Error: Database connection failed\n at ...',
    );
  });

  it('should retain OTLP metric datapoints for the Studio analytics view', async () => {
    const req = mockRequest({
      resourceMetrics: [
        {
          resource: {
            attributes: [
              { key: 'service.name', value: { stringValue: 'test-app' } },
            ],
          },
          scopeMetrics: [
            {
              metrics: [
                {
                  name: 'http.server.duration',
                  histogram: {
                    dataPoints: [
                      {
                        sum: 42.5,
                        count: '3',
                        timeUnixNano: '1672531199000000000',
                        attributes: [
                          { key: 'http.method', value: { stringValue: 'GET' } },
                        ],
                      },
                    ],
                  },
                },
                {
                  name: 'process.cpu.utilization',
                  gauge: { dataPoints: [{ asDouble: 0.42 }] },
                },
              ],
            },
          ],
        },
      ],
    });
    const { res, getBody, getStatus } = mockResponse();

    await handlePostOtlpMetrics(req, res);

    expect(getStatus()).toBe(200);
    expect(getBody()).toMatchObject({ success: true, accepted: 2 });
    expect(recordedMetrics).toHaveLength(2);
    expect(recordedMetrics[0]).toMatchObject({
      name: 'http.server.duration',
      type: 'histogram',
      value: 42.5,
      attributes: { 'service.name': 'test-app', 'http.method': 'GET' },
    });

    const { res: getRes, getBody: getMetricsBody } = mockResponse();
    handleGetOtlpMetrics({} as any, getRes);
    expect(getMetricsBody().metrics).toHaveLength(2);
    expect(getMetricsBody().metrics[0].name).toBe('process.cpu.utilization');

    const { res: deleteRes, getStatus: getDeleteStatus } = mockResponse();
    handleDeleteOtlpMetrics({} as any, deleteRes);
    expect(getDeleteStatus()).toBe(200);
    expect(recordedMetrics).toHaveLength(0);
  });

  it('should retain exponential histograms and summaries', async () => {
    const req = mockRequest({
      resourceMetrics: [
        {
          scopeMetrics: [
            {
              metrics: [
                {
                  name: 'queue.latency',
                  exponentialHistogram: {
                    dataPoints: [{ sum: 12, count: '2' }],
                  },
                },
                {
                  name: 'rpc.duration.summary',
                  summary: { dataPoints: [{ sum: 40, count: '4' }] },
                },
              ],
            },
          ],
        },
      ],
    });
    const { res, getBody } = mockResponse();

    await handlePostOtlpMetrics(req, res);

    expect(getBody()).toMatchObject({ success: true, accepted: 2 });
    expect(recordedMetrics).toMatchObject([
      { name: 'queue.latency', type: 'exponentialHistogram', value: 12 },
      { name: 'rpc.duration.summary', type: 'summary', value: 40 },
    ]);
  });

  it('handles empty, malformed, unsupported, and oversized metric payloads', async () => {
    const empty = mockResponse();
    await handlePostOtlpMetrics(mockRawRequest(''), empty.res);
    expect(empty.getBody()).toEqual({ success: true, accepted: 0 });

    const malformed = mockResponse();
    await handlePostOtlpMetrics(mockRawRequest('{'), malformed.res);
    expect(malformed.getStatus()).toBe(500);
    expect(malformed.getBody().error).toBe('Failed to process metrics');

    const points = Array.from({ length: 2_001 }, (_, index) => ({
      asInt: index,
    }));
    const mixed = mockResponse();
    await handlePostOtlpMetrics(
      mockRequest({
        resourceMetrics: [
          {
            scopeMetrics: [
              {
                metrics: [
                  { name: 'unsupported' },
                  {
                    name: 'invalid',
                    sum: { dataPoints: [{ asDouble: 'not-a-number' }] },
                  },
                  { name: 'counter', sum: { dataPoints: points } },
                ],
              },
            ],
          },
        ],
      }),
      mixed.res,
    );
    expect(mixed.getBody()).toEqual({ success: true, accepted: 2_001 });
    expect(recordedMetrics).toHaveLength(2_000);
  });

  it('should clear recorded spans on delete', () => {
    recordedSpans.push({
      traceId: 't1',
      spanId: 's1',
      name: 'span1',
      startTimeMs: 100,
      durationMs: 10,
      attributes: {},
      status: { code: 0 },
    });

    const { res, getStatus } = mockResponse();
    handleDeleteOtlpTraces({} as any, res);

    expect(getStatus()).toBe(200);
    expect(recordedSpans.length).toBe(0);
  });
});
