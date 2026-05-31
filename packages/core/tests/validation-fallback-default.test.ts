import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import Module from 'module';

function makeReq(overrides: any = {}): any {
  return {
    id: 'req_1',
    method: 'GET',
    url: '/test',
    path: '/test',
    ip: '127.0.0.1',
    headers: {},
    body: undefined,
    query: {},
    params: {},
    state: {},
    raw: {},
    stream: null,
    ...overrides,
  };
}

const originalRequire = Module.prototype.require;
const mockRegistry: Record<string, () => any> = {};

Module.prototype.require = function (this: any, id: string, ...args: any[]) {
  if (mockRegistry[id]) {
    return mockRegistry[id]();
  }
  return originalRequire.call(this, id, ...args);
};

describe('ValidationCompiler Fallback — Default and Schema fallbacks', () => {
  it('covers mod.default ?? mod branch where mod.default is undefined', async () => {
    const MockAjv = function (this: any) {
      this.compile = () => () => true;
    };
    mockRegistry['ajv/dist/2020'] = () => {
      return MockAjv;
    };

    const { ValidationCompiler } = await import('../src/validation');
    const compiler = new ValidationCompiler();
    compiler.compile('POST:/fallback-default', {
      body: z.object({ id: z.string() }),
    });

    const req = makeReq({ body: { id: 'ok' } });
    expect(() => compiler.execute('POST:/fallback-default', req)).not.toThrow();

    delete mockRegistry['ajv/dist/2020'];
  });

  it('handles zod-to-json-schema import failure fallback', async () => {
    mockRegistry['zod-to-json-schema'] = () => {
      throw new Error('zod-to-json-schema not found');
    };

    const { ValidationCompiler } = await import('../src/validation');
    const compiler = new ValidationCompiler();

    compiler.compile('POST:/fallback-zod-schema', {
      body: z.object({ id: z.string() }),
    });

    const reqOk = makeReq({ body: { id: 'ok' } });
    expect(() =>
      compiler.execute('POST:/fallback-zod-schema', reqOk),
    ).not.toThrow();

    delete mockRegistry['zod-to-json-schema'];
  });

  it('handles Zod v4 toJSONSchema branch coverage', async () => {
    const { ValidationCompiler } = await import('../src/validation');
    const compiler = new ValidationCompiler();

    // Mock schema to look like Zod v4 (has toJSONSchema function)
    const mockSchema = z.string() as any;
    mockSchema.toJSONSchema = () => ({ type: 'string' });

    compiler.compile('GET:/zod-v4-compat', {
      body: mockSchema,
    });

    const req = makeReq({ body: 'hello' });
    expect(() => compiler.execute('GET:/zod-v4-compat', req)).not.toThrow();
  });
});
