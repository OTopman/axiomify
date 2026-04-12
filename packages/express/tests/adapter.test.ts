import { describe, expect, it, vi } from 'vitest';
import { translateRequest, translateResponse } from '../src/translator';

const mockSerializer = (
  data: any,
  message?: string,
  statusCode?: number,
  isError?: boolean,
) => ({
  status: isError || (statusCode && statusCode >= 400) ? 'failed' : 'success',
  data,
});

describe('Express Adapter Translators', () => {
  it('maps method, path, ip, body, query, and headers via translateRequest', () => {
    const mockExpressReq: any = {
      method: 'POST',
      path: '/api/v1/test',
      ip: '127.0.0.1',
      body: { key: 'value' },
      query: { search: 'term' },
      headers: { authorization: 'Bearer token' },
    };

    const req = translateRequest(mockExpressReq);

    expect(req.method).toBe('POST');
    expect(req.path).toBe('/api/v1/test');
    expect(req.ip).toBe('127.0.0.1');
    expect(req.body).toStrictEqual({ key: 'value' });
    expect(req.query).toStrictEqual({ search: 'term' });
    expect(req.headers.authorization).toBe('Bearer token');
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
      mockExpressRes as any,
      mockSerializer,
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
      mockExpressRes as any,
      mockSerializer,
    );
    axiomifyRes.status(400).send(null);

    expect(mockExpressRes.status).toHaveBeenCalledWith(400);
    expect(mockExpressRes.json).toHaveBeenCalledWith({
      status: 'failed',
      data: null,
    });
  });

  it('translateResponse.sendRaw() sets the Content-Type header correctly', () => {
    const mockExpressRes: any = {
      status: vi.fn().mockReturnThis(),
      send: vi.fn(),
      setHeader: vi.fn(),
    };

    const res = translateResponse(mockExpressRes);
    res.sendRaw('<html/>', 'text/html');

    expect(mockExpressRes.setHeader).toHaveBeenCalledWith(
      'Content-Type',
      'text/html',
    );
    expect(mockExpressRes.send).toHaveBeenCalledWith('<html/>');
  });
});
