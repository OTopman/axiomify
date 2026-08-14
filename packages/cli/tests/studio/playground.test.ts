import { describe, expect, it } from 'vitest';
import {
  getPlaygroundSdk,
  handleGetPlaygroundSdk,
  handlePostPlaygroundExecute,
} from '../../src/studio/api/playground';

describe('SDK Playground & Sandbox execution', () => {
  const mockApp = {
    registeredRoutes: [
      {
        method: 'GET',
        path: '/users',
        schema: {
          summary: 'Get users list',
          response: {
            safeParse: () => ({ success: true }),
            toJSONSchema: () => ({ type: 'object' }),
          },
        },
      },
    ],
    registeredWsRoutes: [],
  };

  it('should generate in-memory TS SDK files and starter snippet', async () => {
    const result = await getPlaygroundSdk(mockApp);

    expect(result).toBeDefined();
    expect(result.starterCode).toContain('ApiClient');
    expect(result.files.length).toBeGreaterThan(0);

    const clientFile = result.files.find((f) => f.path === 'client.ts');
    expect(clientFile).toBeDefined();
    expect(clientFile?.content).toContain('class ApiClient');
  });

  it('serves the generated SDK with the active application base URL', async () => {
    let statusCode = 0;
    let responseData: any;
    const req = {
      url: '/__studio/api/playground/sdk?target=typescript',
    } as any;
    const res = {
      writeHead(code: number) {
        statusCode = code;
      },
      end(data: string) {
        responseData = JSON.parse(data);
      },
    } as any;

    await handleGetPlaygroundSdk(req, res, mockApp);

    expect(statusCode).toBe(200);
    expect(responseData.appBaseUrl).toBe('http://localhost:3000');
    expect(responseData.starterCode).toContain(responseData.appBaseUrl);
  });

  it('refuses to execute code unless AXIOMIFY_STUDIO_ALLOW_EXEC is set', async () => {
    // Security (C1): code execution is disabled by default.
    const prev = process.env.AXIOMIFY_STUDIO_ALLOW_EXEC;
    delete process.env.AXIOMIFY_STUDIO_ALLOW_EXEC;
    let responseData: any = null;
    const mockReq: any = {
      on: (event: string, cb: any) => {
        if (event === 'data') {
          cb(Buffer.from(JSON.stringify({ code: 'console.log("hi");' })));
        }
        if (event === 'end') cb();
        return mockReq;
      },
    };
    let statusCode = 200;
    const mockRes: any = {
      writeHead: (code: number) => {
        statusCode = code;
      },
      end: (data: string) => {
        responseData = JSON.parse(data);
      },
    };
    await handlePostPlaygroundExecute(mockReq, mockRes, mockApp);
    expect(statusCode).toBe(403);
    expect(responseData.error).toContain('disabled');
    if (prev !== undefined) process.env.AXIOMIFY_STUDIO_ALLOW_EXEC = prev;
  });

  it('should execute arbitrary TS code inside sandboxed VM and capture console logs', async () => {
    // Explicit opt-in required (security gate for C1).
    process.env.AXIOMIFY_STUDIO_ALLOW_EXEC = 'true';
    let responseData: any = null;

    const mockReq: any = {
      on: (event: string, cb: any) => {
        if (event === 'data') {
          cb(
            Buffer.from(
              JSON.stringify({
                code: `console.log("Hello from VM sandbox!");\nconsole.error("Warning error!");`,
              }),
            ),
          );
        }
        if (event === 'end') {
          cb();
        }
        return mockReq;
      },
    };

    const mockRes: any = {
      writeHead: () => {},
      end: (data: string) => {
        responseData = JSON.parse(data);
      },
    };

    await handlePostPlaygroundExecute(mockReq, mockRes, mockApp);

    expect(responseData).not.toBeNull();
    expect(responseData.error).toBeUndefined();
    expect(responseData.logs).toContain('Hello from VM sandbox!');
    expect(responseData.errors).toContain('Warning error!');
  });
});
