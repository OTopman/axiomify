import { describe, expect, it } from 'vitest';
import type { StudioDiscoveryResult } from '../../src/studio/discovery/types';
import pkg from '../../package.json';

// We can import the internal builders from export.ts by casting the module or exporting them.
// Let's check: since we exported the HTTP handlers, can we also export the builders, or do we test via handler mock?
// Wait, we didn't export buildHtmlReport and buildMarkdownReport from export.ts, but we can export them!
// Let's modify export.ts to export buildHtmlReport and buildMarkdownReport so they are testable,
// or we can test them via the handleExportHtml/handleExportMarkdown functions by mocking the ServerResponse.
// Testing via handleExportHtml/handleExportMarkdown is extremely clean:

import {
  handleExportHtml,
  handleExportMarkdown,
} from '../../src/studio/api/export';

describe('Studio Report Exporter', () => {
  const mockDiscovery: StudioDiscoveryResult = {
    routes: [
      {
        method: 'GET',
        path: '/api/users',
        isWs: false,
        validation: ['query', 'response'],
        tags: ['users'],
        deprecated: false,
        pluginCount: 1,
        plugins: ['auth'],
        hasResponseSchema: true,
      },
      {
        method: 'WS',
        path: '/ws/chat',
        isWs: true,
        validation: ['message'],
        tags: ['websocket'],
        deprecated: false,
        pluginCount: 0,
        plugins: [],
        hasResponseSchema: false,
      },
    ],
    schemas: [
      {
        routeId: 'GET:/api/users',
        method: 'GET',
        path: '/api/users',
        query: { type: 'object' },
        response: { type: 'object' },
      },
      {
        routeId: 'WS:/ws/chat',
        method: 'WS',
        path: '/ws/chat',
        message: { type: 'object' },
      },
    ],
    hooks: [],
    config: {
      timeout: 3000,
      routeConflict: 'throw',
      strictSchema: true,
      httpRouteCount: 1,
      wsRouteCount: 1,
      hookCount: 0,
      serviceCount: 0,
    },
    openapi: null,
    health: { findings: [], summary: { passes: 1, warnings: 0, failures: 0 } },
    discoveredAt: new Date().toISOString(),
  };

  const mockApp = {
    registeredRoutes: [],
    registeredWsRoutes: [],
  };

  it('should generate HTML report with correct Content-Type', () => {
    let writeHeadCalled = false;
    let endCalled = false;
    let contentType = '';
    let contentDisposition = '';
    let responseHtml = '';

    const mockRes: any = {
      writeHead: (status: number, headers: any) => {
        writeHeadCalled = true;
        expect(status).toBe(200);
        contentType = headers['Content-Type'];
        contentDisposition = headers['Content-Disposition'];
      },
      end: (data: string) => {
        endCalled = true;
        responseHtml = data;
      },
    };

    handleExportHtml({} as any, mockRes, mockApp, () => mockDiscovery);

    expect(writeHeadCalled).toBe(true);
    expect(endCalled).toBe(true);
    expect(contentType).toContain('text/html');
    expect(contentDisposition).toContain('attachment');
    expect(responseHtml).toContain('<!DOCTYPE html>');
    expect(responseHtml).toContain('Axiomify Studio Report');
    expect(responseHtml).toContain('HTTP Routes');
    expect(responseHtml).toContain('WebSocket Routes');
    expect(responseHtml).toContain(`Axiomify Studio v${pkg.version}`);
    expect(responseHtml).not.toContain('Axiomify Studio v1.0');
  });

  it('should generate Markdown report with correct Content-Type', () => {
    let writeHeadCalled = false;
    let endCalled = false;
    let contentType = '';
    let contentDisposition = '';
    let responseMd = '';

    const mockRes: any = {
      writeHead: (status: number, headers: any) => {
        writeHeadCalled = true;
        expect(status).toBe(200);
        contentType = headers['Content-Type'];
        contentDisposition = headers['Content-Disposition'];
      },
      end: (data: string) => {
        endCalled = true;
        responseMd = data;
      },
    };

    handleExportMarkdown({} as any, mockRes, mockApp, () => mockDiscovery);

    expect(writeHeadCalled).toBe(true);
    expect(endCalled).toBe(true);
    expect(contentType).toContain('text/markdown');
    expect(contentDisposition).toContain('attachment');
    expect(responseMd).toContain('# ✨ Axiomify Studio Report');
    expect(responseMd).toContain('## 📊 Discovery Summary');
    expect(responseMd).toContain(`Axiomify Studio v${pkg.version}`);
    expect(responseMd).not.toContain('Axiomify Studio v1.0');
  });
});
