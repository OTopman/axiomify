import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { Axiomify } from '../src/app';

describe('Axiomify Native Telemetry', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should support enableTracing method chain', () => {
    const app = new Axiomify();
    expect(typeof app.enableTracing).toBe('function');
    const returnedApp = app.enableTracing();
    expect(returnedApp).toBe(app);
  });

  it('should initialize OpenTelemetry configuration on enableTracing', () => {
    const app = new Axiomify();
    
    // Trigger enableTracing
    app.enableTracing();
    
    // Verify initialization flag is set
    expect((app as any).__otelInitialized).toBe(true);
  });

  it('should patch dispatcher methods upon initialization', () => {
    const app = new Axiomify();
    const dispatcher = (app as any).dispatcher;
    
    const originalHandle = dispatcher.handle;
    const originalHandleMatchedRoute = dispatcher.handleMatchedRoute;

    app.enableTracing();

    expect(dispatcher.handle).not.toBe(originalHandle);
    expect(dispatcher.handleMatchedRoute).not.toBe(originalHandleMatchedRoute);
  });

  it('should instrument console methods upon enableTracing', () => {
    const app = new Axiomify();
    app.enableTracing();
    expect((globalThis as any).__axiomifyOtelLogsInstrumented).toBe(true);
  });
});
