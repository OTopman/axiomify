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

describe('ValidationCompiler Fallback — Null Errors List', () => {
  it('covers ajvValidate.errors ?? [] branch', async () => {
    const validate = () => false;
    (validate as any).errors = null;
    const compile = () => validate;
    const MockAjv = function (this: any) {
      this.compile = compile;
    };
    mockRegistry['ajv/dist/2020'] = () => {
      return {
        default: MockAjv,
      };
    };

    const { ValidationCompiler, ValidationError } =
      await import('../src/validation');
    const compiler = new ValidationCompiler();
    compiler.compile('POST:/null-errors', {
      body: z.object({ id: z.string() }),
    });

    const req = makeReq({ body: { id: 123 } });
    try {
      compiler.execute('POST:/null-errors', req);
      throw new Error('Should have thrown ValidationError');
    } catch (err: any) {
      expect(err).toBeInstanceOf(ValidationError);
      expect(err.errors.body).toEqual({});
    }

    delete mockRegistry['ajv/dist/2020'];
  });
});
