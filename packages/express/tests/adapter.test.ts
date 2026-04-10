import { describe, expect, it, vi } from 'vitest';
import { translateRequest, translateResponse } from '../src/translator';

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

    const res = translateResponse(mockExpressRes);
    res.status(200).send({ user: 1 }, 'User fetched');

    expect(mockExpressRes.json).toHaveBeenCalledWith({
      status: 'success',
      message: 'User fetched',
      data: { user: 1 },
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

    const res = translateResponse(mockExpressRes);
    res.status(400).send({ error: 'Bad Data' }, 'Validation failed');

    expect(mockExpressRes.json).toHaveBeenCalledWith({
      status: 'failed',
      message: 'Validation failed',
      data: { error: 'Bad Data' },
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
