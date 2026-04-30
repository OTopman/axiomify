import { describe, expect, it, vi } from 'vitest';
import { translateRequest, translateResponse } from '../src/translator';

// Minimal serializer that mirrors the default Axiomify envelope shape.
const mockSerializer = (
  data: unknown,
  _message?: string,
  statusCode?: number,
  isError?: boolean,
) => ({
  status: isError || (statusCode && statusCode >= 400) ? 'failed' : 'success',
  data,
});

// Minimal mock AxiomifyRequest — only the fields translateResponse forwards
// to the serializer need to be present.
const mockAxiomifyReq: any = {
  id: 'test-id',
  method: 'GET',
  url: '/test',
  path: '/test',
  ip: '127.0.0.1',
  headers: {},
  body: {},
  query: {},
  params: {},
  state: {},
  raw: null,
  stream: null,
};

describe('Express Adapter Translators', () => {
  it('maps method, path, ip, body, query, and headers via translateRequest', () => {
    const mockExpressReq: any = {
      method: 'POST',
      path: '/api/v1/test',
      url: '/api/v1/test',
      ip: '127.0.0.1',
      body: { key: 'value' },
      query: { search: 'term' },
      headers: { authorization: 'Bearer token' },
      params: {},
      socket: { remoteAddress: '127.0.0.1' },
    };

    const req = translateRequest(mockExpressReq);

    expect(req.method).toBe('POST');
    expect(req.path).toBe('/api/v1/test');
    expect(req.ip).toBe('127.0.0.1');
    expect(req.body).toStrictEqual({ key: 'value' });
    expect(req.query).toStrictEqual({ search: 'term' });
    expect(req.headers.authorization).toBe('Bearer token');
  });

  it('strips __proto__, constructor, and prototype keys from body via translateRequest', () => {
    const mockExpressReq: any = {
      method: 'POST',
      path: '/api',
      url: '/api',
      ip: '127.0.0.1',
      body: {
        safe: 'yes',
        __proto__: { polluted: true },
        constructor: { bad: true },
        prototype: { bad: true },
      },
      query: {},
      headers: {},
      params: {},
      socket: { remoteAddress: '127.0.0.1' },
    };

    const req = translateRequest(mockExpressReq);
    expect((req.body as any).safe).toBe('yes');
    expect((req.body as any).__proto__).toBeUndefined();
    expect((req.body as any).constructor).toBeUndefined();
  });

  it('falls back to socket.remoteAddress when req.ip is absent', () => {
    const mockExpressReq: any = {
      method: 'GET',
      path: '/',
      url: '/',
      ip: undefined,
      body: {},
      query: {},
      headers: {},
      params: {},
      socket: { remoteAddress: '10.0.0.1' },
    };

    const req = translateRequest(mockExpressReq);
    expect(req.ip).toBe('10.0.0.1');
  });

  it('formats translateResponse.send() with 2xx status as success', () => {
    const mockExpressRes: any = {
      statusCode: 200,
      status: vi.fn().mockImplementation(function (this: any, code: number) {
        this.statusCode = code;
        return this;
      }),
      json: vi.fn(),
      setHeader: vi.fn(),
    };

    const axiomifyRes = translateResponse(
      mockExpressRes,
      mockSerializer,
      mockAxiomifyReq,
    );
    axiomifyRes.status(200).send({ id: 1 });

    expect(mockExpressRes.status).toHaveBeenCalledWith(200);
    expect(mockExpressRes.json).toHaveBeenCalledWith({
      status: 'success',
      data: { id: 1 },
    });
  });

  it('formats translateResponse.send() with 4xx status as failed', () => {
    const mockExpressRes: any = {
      statusCode: 200,
      status: vi.fn().mockImplementation(function (this: any, code: number) {
        this.statusCode = code;
        return this;
      }),
      json: vi.fn(),
      setHeader: vi.fn(),
    };

    const axiomifyRes = translateResponse(
      mockExpressRes,
      mockSerializer,
      mockAxiomifyReq,
    );
    axiomifyRes.status(400).send(null);

    expect(mockExpressRes.status).toHaveBeenCalledWith(400);
    expect(mockExpressRes.json).toHaveBeenCalledWith({
      status: 'failed',
      data: null,
    });
  });

  it('translateResponse.send() is idempotent — second call is ignored', () => {
    const mockExpressRes: any = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
      setHeader: vi.fn(),
    };

    const res = translateResponse(
      mockExpressRes,
      mockSerializer,
      mockAxiomifyReq,
    );
    res.status(200).send({ first: true });
    res.status(200).send({ second: true }); // must be ignored

    expect(mockExpressRes.json).toHaveBeenCalledTimes(1);
    expect(mockExpressRes.json).toHaveBeenCalledWith(
      expect.objectContaining({ data: { first: true } }),
    );
  });

  it('translateResponse.sendRaw() sets the Content-Type header correctly', () => {
    const mockExpressRes: any = {
      status: vi.fn().mockReturnThis(),
      send: vi.fn(),
      setHeader: vi.fn(),
    };

    const res = translateResponse(
      mockExpressRes,
      mockSerializer,
      mockAxiomifyReq,
    );
    res.sendRaw('<html/>', 'text/html');

    expect(mockExpressRes.setHeader).toHaveBeenCalledWith(
      'Content-Type',
      'text/html',
    );
    expect(mockExpressRes.send).toHaveBeenCalledWith('<html/>');
  });

  it('translateResponse.removeHeader() delegates to res.removeHeader', () => {
    const mockExpressRes: any = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
      setHeader: vi.fn(),
      removeHeader: vi.fn(),
    };

    const res = translateResponse(
      mockExpressRes,
      mockSerializer,
      mockAxiomifyReq,
    );
    res.removeHeader('X-Powered-By');

    expect(mockExpressRes.removeHeader).toHaveBeenCalledWith('X-Powered-By');
  });

  it('translateResponse.error() sends 500 with error message', () => {
    const mockExpressRes: any = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
      setHeader: vi.fn(),
    };

    const res = translateResponse(
      mockExpressRes,
      mockSerializer,
      mockAxiomifyReq,
    );
    res.error(new Error('something went wrong'));

    expect(mockExpressRes.status).toHaveBeenCalledWith(500);
    expect(mockExpressRes.json).toHaveBeenCalled();
  });
});
