import { describe, expect, it } from 'vitest';
import {
  getPlaygroundSdk,
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

  it('should execute arbitrary TS code inside sandboxed VM and capture console logs', async () => {
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
