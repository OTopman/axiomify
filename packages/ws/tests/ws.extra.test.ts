import { describe, expect, it, vi } from 'vitest';
import { Axiomify } from '@axiomify/core';
import { getServerFromAdapter, getWsManager, setWsManager } from '../src/index';

describe('getServerFromAdapter', () => {
  it('extracts server from http-adapter-like object (.server with .on)', () => {
    const fakeServer = { on: vi.fn(), listening: true };
    const adapter = { server: fakeServer };
    expect(getServerFromAdapter(adapter)).toBe(fakeServer);
  });

  it('extracts server from fastify-adapter-like object (app.server)', () => {
    const fakeServer = { on: vi.fn() };
    const adapter = { app: { server: fakeServer } };
    expect(getServerFromAdapter(adapter)).toBe(fakeServer);
  });

  it('extracts server from hapi-adapter-like object (server.listener)', () => {
    const fakeServer = { on: vi.fn() };
    const adapter = { server: { listener: fakeServer } };
    expect(getServerFromAdapter(adapter)).toBe(fakeServer);
  });

  it('throws when no server can be found', () => {
    expect(() => getServerFromAdapter({})).toThrow(
      /Could not extract http\.Server from adapter/,
    );
  });
});

describe('setWsManager / getWsManager', () => {
  it('stores and retrieves a WsManager on the Axiomify instance', () => {
    const app = new Axiomify();
    const fakeManager = { rooms: new Map() } as any;
    setWsManager(app, fakeManager);
    expect(getWsManager(app)).toBe(fakeManager);
  });

  it('returns undefined when no manager has been set', () => {
    const app = new Axiomify();
    expect(getWsManager(app)).toBeUndefined();
  });
});
