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

describe('ValidationCompiler Fallback — AJV Failure', () => {
  it('handles AJV import failure (Zod fallback) and root body missing error mapping', async () => {
    mockRegistry['ajv/dist/2020'] = () => {
      throw new Error('ajv not found');
    };

    const { ValidationCompiler, ValidationError } =
      await import('../src/validation');
    const compiler = new ValidationCompiler();

    // Compile schema
    compiler.compile('POST:/fallback-ajv', {
      body: z.object({ id: z.string() }),
    });

    // Verify it still functions using Zod
    const reqOk = makeReq({ body: { id: 'ok' } });
    expect(() => compiler.execute('POST:/fallback-ajv', reqOk)).not.toThrow();

    // Verify root body missing error maps correctly (lines 209-210, 212)
    const reqMissing = makeReq({ body: undefined });
    try {
      compiler.execute('POST:/fallback-ajv', reqMissing);
      throw new Error('Should have thrown');
    } catch (err: any) {
      expect(err).toBeInstanceOf(ValidationError);
      expect(err.errors.body._root).toContain('missing or empty');
    }

    delete mockRegistry['ajv/dist/2020'];
  });

  it('handles null body for root body missing error mapping in Zod', async () => {
    mockRegistry['ajv/dist/2020'] = () => {
      throw new Error('ajv not found');
    };

    const { ValidationCompiler, ValidationError } =
      await import('../src/validation');
    const compiler = new ValidationCompiler();

    compiler.compile('POST:/fallback-ajv-null', {
      body: z.object({ id: z.string() }),
    });

    const reqMissing = makeReq({ body: null });
    try {
      compiler.execute('POST:/fallback-ajv-null', reqMissing);
      throw new Error('Should have thrown');
    } catch (err: any) {
      expect(err).toBeInstanceOf(ValidationError);
      expect(err.errors.body._root).toContain('missing or empty');
    }

    delete mockRegistry['ajv/dist/2020'];
  });
});
