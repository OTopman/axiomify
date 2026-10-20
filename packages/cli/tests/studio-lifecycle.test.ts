import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const app = {};
  const reloadedApp = {};
  const discovery = {
    config: { httpRouteCount: 1, wsRouteCount: 0, hookCount: 0 },
    schemas: [],
  };
  const wsServer = {
    broadcast: vi.fn(),
    close: vi.fn(),
    handleUpgrade: vi.fn(),
  };
  let capturedUpgradeListener: ((req: any, socket: any) => void) | undefined;
  const server = {
    on: vi.fn((event: string, handler: (req: any, socket: any) => void) => {
      if (event === 'upgrade') {
        capturedUpgradeListener = handler;
      }
      return server;
    }),
    close: vi.fn(),
  };
  return {
    app,
    reloadedApp,
    discovery,
    wsServer,
    server,
    getUpgradeListener: () => capturedUpgradeListener,
    setAppBaseUrl: vi.fn(),
    instrumentEventRecording: vi.fn(),
    instrumentErrorObservatory: vi.fn(),
    instrumentWsAnalytics: vi.fn(),
    instrumentRequestReplay: vi.fn(),
    instrumentTrafficProfiling: vi.fn(),
  };
});

vi.mock('../src/utils/load-app', () => ({
  loadApp: vi.fn(async () => ({
    app: mocks.app,
    cleanup: vi.fn(async () => {}),
    exports: { app: mocks.app },
  })),
}));
vi.mock('../src/studio/api', () => ({ registerStudioApi: vi.fn() }));
vi.mock('../src/studio/api/contracts', () => ({
  getContractsAutoRun: vi.fn(() => false),
  runAllContractTests: vi.fn(),
  setOnContractsUpdated: vi.fn(),
}));
vi.mock('../src/studio/api/errors', () => ({
  instrumentErrorObservatory: mocks.instrumentErrorObservatory,
}));
vi.mock('../src/studio/api/events', () => ({
  instrumentEventRecording: mocks.instrumentEventRecording,
}));
vi.mock('../src/studio/api/logs', () => ({
  instrumentLogs: vi.fn(),
  setOnLogsUpdated: vi.fn(),
}));
vi.mock('../src/studio/api/perf', () => ({ setOnPerfUpdated: vi.fn() }));
vi.mock('../src/studio/api/recorder', () => ({
  setOnRecorderUpdated: vi.fn(),
}));
vi.mock('../src/studio/api/replay', () => ({
  instrumentRequestReplay: mocks.instrumentRequestReplay,
  setOnReplayUpdated: vi.fn(),
}));
vi.mock('../src/studio/api/sdk-impact', () => ({
  setBaselineDiscovery: vi.fn(),
}));
vi.mock('../src/studio/api/traffic-interceptor', () => ({
  instrumentTrafficProfiling: mocks.instrumentTrafficProfiling,
}));
vi.mock('../src/studio/api/ws-analytics', () => ({
  instrumentWsAnalytics: mocks.instrumentWsAnalytics,
  stopWsMetricsInterval: vi.fn(),
  clearRoomManagers: vi.fn(),
}));
vi.mock('../src/studio/api/otlp', () => ({ setOnTracesUpdated: vi.fn() }));
vi.mock('../src/studio/api/ws-tester', () => ({
  setAppBaseUrl: mocks.setAppBaseUrl,
}));
vi.mock('../src/studio/discovery', () => ({
  performDiscovery: vi.fn(async () => mocks.discovery),
}));
vi.mock('../src/studio/server/router', () => ({
  StudioRouter: class StudioRouter {},
}));
vi.mock('../src/studio/server/ws-server', () => ({
  StudioWsServer: class StudioWsServer {
    broadcast = mocks.wsServer.broadcast;
    close = mocks.wsServer.close;
    handleUpgrade = mocks.wsServer.handleUpgrade;
  },
}));
vi.mock('../src/studio/server/http-server', () => ({
  createStudioServer: vi.fn((options: any) => {
    if (options?.onReady) {
      options.onReady(
        options.port ?? 4399,
        `http://localhost:${options.port ?? 4399}`,
      );
    }
    return mocks.server;
  }),
}));
vi.mock('../src/studio/sync', () => ({
  StudioSyncEngine: class StudioSyncEngine {
    constructor(
      private readonly options: {
        onReload: (
          discovery: typeof mocks.discovery,
          app: object,
          exports: object,
        ) => void;
      },
    ) {}

    async start() {
      this.options.onReload(mocks.discovery, mocks.reloadedApp, {});
    }

    async stop() {}
  },
}));

import { startStudio } from '../src/studio';

describe('Studio lifecycle', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('applies the app URL and instruments event recording on load and reload', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(process, 'once').mockImplementation(() => process);

    await startStudio('src/app.ts', {
      port: 4400,
      open: false,
      appUrl: 'http://127.0.0.1:3000',
    });

    expect(mocks.setAppBaseUrl).toHaveBeenCalledWith('http://127.0.0.1:3000');
    expect(mocks.instrumentEventRecording).toHaveBeenCalledWith(mocks.app);
    expect(mocks.instrumentEventRecording).toHaveBeenCalledWith(
      mocks.reloadedApp,
    );
  });

  it('handles WebSocket upgrades for /__studio/ws and /__studio/live with valid token', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(process, 'once').mockImplementation(() => process);

    await startStudio('src/app.ts', {
      port: 4400,
      open: false,
    });

    const upgradeListener = mocks.getUpgradeListener();
    expect(upgradeListener).toBeDefined();

    const token = process.env.AXIOMIFY_STUDIO_TOKEN;
    expect(token).toBeTruthy();

    // 1. Valid upgrade on /__studio/ws
    const wsReq = {
      url: `/__studio/ws?token=${token}`,
      headers: { host: 'localhost:4400' },
    };
    const wsSocket = { write: vi.fn(), destroy: vi.fn() };
    upgradeListener!(wsReq, wsSocket);
    expect(mocks.wsServer.handleUpgrade).toHaveBeenCalledWith(wsReq, wsSocket);

    // 2. Valid upgrade on /__studio/live
    const liveReq = {
      url: `/__studio/live?token=${token}`,
      headers: { host: 'localhost:4400' },
    };
    const liveSocket = { write: vi.fn(), destroy: vi.fn() };
    upgradeListener!(liveReq, liveSocket);
    expect(mocks.wsServer.handleUpgrade).toHaveBeenCalledWith(
      liveReq,
      liveSocket,
    );

    // 3. Unauthorized upgrade with invalid token
    const unauthReq = {
      url: '/__studio/ws?token=invalid-token',
      headers: { host: 'localhost:4400' },
    };
    const unauthSocket = { write: vi.fn(), destroy: vi.fn() };
    upgradeListener!(unauthReq, unauthSocket);
    expect(unauthSocket.write).toHaveBeenCalledWith(
      'HTTP/1.1 401 Unauthorized\r\n\r\n',
    );
    expect(unauthSocket.destroy).toHaveBeenCalled();

    // 4. Non-matching path destroys socket
    const otherReq = {
      url: '/some-other-path',
      headers: { host: 'localhost:4400' },
    };
    const otherSocket = { write: vi.fn(), destroy: vi.fn() };
    upgradeListener!(otherReq, otherSocket);
    expect(otherSocket.destroy).toHaveBeenCalled();

    // 5. Default url ('/') and default host ('localhost') when omitted
    const defaultReq = {
      url: undefined,
      headers: {},
    };
    const defaultSocket = { write: vi.fn(), destroy: vi.fn() };
    upgradeListener!(defaultReq, defaultSocket);
    expect(defaultSocket.destroy).toHaveBeenCalled();
  });
});
