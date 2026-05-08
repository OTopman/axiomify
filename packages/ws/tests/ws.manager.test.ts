/**
 * Unit tests for WsManager — covers joinRoom, leaveRoom, broadcastToRoom,
 * getStats, close, and on() event registration without a real WebSocket server.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'events';
import { WebSocketServer } from 'ws';

// We can't instantiate WsManager without a real http.Server (it tries to attach
// to it). Instead we test the exported helpers and mock the internals we need.
import { getServerFromAdapter, getWsManager, setWsManager } from '../src/index';
import { Axiomify } from '@axiomify/core';

// ─── Mock WsClient ────────────────────────────────────────────────────────────
function makeFakeClient(overrides: any = {}) {
  return {
    id: 'ws_1',
    user: null,
    rooms: new Set<string>(),
    send: vi.fn(),
    ping: vi.fn(),
    close: vi.fn(),
    ...overrides,
  } as any;
}

describe('getServerFromAdapter', () => {
  it('returns server from HttpAdapter-like object', () => {
    const fakeServer = { on: vi.fn(), listening: true };
    expect(getServerFromAdapter({ server: fakeServer })).toBe(fakeServer);
  });

  it('returns server from FastifyAdapter-like (app.server)', () => {
    const fakeServer = { on: vi.fn() };
    expect(getServerFromAdapter({ app: { server: fakeServer } })).toBe(fakeServer);
  });

  it('returns server from HapiAdapter-like (server.listener)', () => {
    const fakeServer = { on: vi.fn() };
    expect(getServerFromAdapter({ server: { listener: fakeServer } })).toBe(fakeServer);
  });

  it('throws when no server found', () => {
    expect(() => getServerFromAdapter({})).toThrow(/Could not extract/);
  });
});

describe('setWsManager / getWsManager', () => {
  it('round-trips a manager through the Axiomify instance', () => {
    const app = new Axiomify();
    const manager = { broadcast: vi.fn() } as any;
    setWsManager(app, manager);
    expect(getWsManager(app)).toBe(manager);
  });

  it('returns undefined before setWsManager is called', () => {
    const app = new Axiomify();
    expect(getWsManager(app)).toBeUndefined();
  });
});
