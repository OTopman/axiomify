import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const app = {};
  const reloadedApp = {};
  const discovery = {
    config: { httpRouteCount: 1, wsRouteCount: 0, hookCount: 0 },
    schemas: [],
  };
  return {
    app,
    reloadedApp,
    discovery,
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
    broadcast = vi.fn();
    close = vi.fn();
    handleUpgrade = vi.fn();
  },
}));
vi.mock('../src/studio/server/http-server', () => ({
  createStudioServer: vi.fn(() => ({ on: vi.fn(), close: vi.fn() })),
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
});
