/**
 * Studio API — route registrar.
 *
 * Registers all Studio API endpoints on the {@link StudioRouter}.
 * Each handler receives the cached {@link StudioDiscoveryResult}
 * via closure, so discovery runs once and all endpoints share the same
 * snapshot until the next live-sync reload.
 */
import type { StudioDiscoveryResult } from '../discovery';
import { sendJson } from '../server/http-server';
import { StudioRouter } from '../server/router';
import { handleGetAiStatus, handlePostAiAnalyze, handlePostAiConfig } from './ai';
import { handleGetConfig } from './config';
import { handleGetContractResults, handlePostRunContracts, handlePostToggleAutoRun } from './contracts';
import { handlePostDebugFrames, handlePostDebugSource } from './debugger';
import { handleGetErrors } from './errors';
import { handleExportHtml, handleExportMarkdown, handleExportPdf } from './export';
import { handleGetHealth } from './health';
import { handleGetHooks } from './hooks';
import { handleDeleteLogs, handleExportLogs, handleGetLogs } from './logs';
import { handleGetAppMetrics } from './metrics';
import { handleGetOpenApi, handlePostOpenApiSync } from './openapi';
import { handleDeletePerf, handleGetPerf } from './perf';
import { handleGetPlaygroundSdk, handlePostPlaygroundExecute } from './playground';
import { handleGetQuality } from './quality';
import {
  handleDeleteSession,
  handleExportHar,
  handleExportSession,
  handleGetSession,
} from './recorder';
import {
  handleDeleteAllRequestReplays,
  handleDeleteRequestReplay,
  handleGetRequestReplays,
  handlePostRequestReplay,
} from './replay';
import { handlePostRequest } from './request';
import { handleGetRoutes } from './routes';
import { handleGetSchemas } from './schemas';
import { handleDeleteAllSdkImpacts, handleDeleteSdkImpact, handleGetSdkImpacts } from './sdk-impact';
import { handleGetSecurityReport, handlePostRunProbes } from './security';
import { handleGetSystem } from './system';
import { handleGetWsAnalytics } from './ws-analytics';
import { handleGetWsRoutes } from './ws-tester';

export interface StudioApiContext {
  /** Returns the latest cached discovery result. */
  getDiscovery: () => StudioDiscoveryResult;
  /** Returns the active Axiomify app instance. */
  getApp: () => any;
}

/**
 * Registers all `/__studio/api/*` endpoints on the provided router.
 *
 * Handlers are thin wrappers that pass the current discovery snapshot
 * to the individual API modules. The discovery snapshot is accessed
 * via a getter so live-sync can update it without re-registering routes.
 */
export function registerStudioApi(
  router: StudioRouter,
  ctx: StudioApiContext,
): void {
  // Full discovery snapshot.
  router.get('/__studio/api/discovery', (_req, res) => {
    sendJson(res, ctx.getDiscovery());
  });

  // Individual resource endpoints.
  router.get('/__studio/api/routes', (req, res) => {
    handleGetRoutes(req, res, ctx.getDiscovery());
  });

  router.get('/__studio/api/schemas', (req, res) => {
    handleGetSchemas(req, res, ctx.getDiscovery());
  });

  router.get('/__studio/api/hooks', (req, res) => {
    handleGetHooks(req, res, ctx.getDiscovery());
  });

  router.get('/__studio/api/config', (req, res) => {
    handleGetConfig(req, res, ctx.getDiscovery());
  });

  router.get('/__studio/api/openapi', (req, res) => {
    handleGetOpenApi(req, res, ctx.getDiscovery());
  });

  router.post('/__studio/api/openapi/sync', (req, res) => {
    handlePostOpenApiSync(req, res, ctx.getDiscovery());
  });

  router.get('/__studio/api/health', (req, res) => {
    handleGetHealth(req, res, ctx.getDiscovery());
  });

  router.get('/__studio/api/system', (req, res) => {
    handleGetSystem(req, res);
  });

  router.get('/__studio/api/metrics', (req, res) => {
    handleGetAppMetrics(req, res, ctx.getApp());
  });

  router.post('/__studio/api/request', (req, res) => {
    handlePostRequest(req, res, ctx.getApp());
  });

  router.get('/__studio/api/errors', (req, res) => {
    handleGetErrors(req, res);
  });

  router.get('/__studio/api/ws-analytics', (req, res) => {
    handleGetWsAnalytics(req, res, ctx.getApp());
  });

  router.post('/__studio/api/request/replay', (req, res) => {
    handlePostRequestReplay(req, res);
  });

  router.get('/__studio/api/request/replays', (req, res) => {
    handleGetRequestReplays(req, res);
  });

  router.on('DELETE', '/__studio/api/request/replay', (req, res) => {
    handleDeleteRequestReplay(req, res);
  });

  router.on('DELETE', '/__studio/api/request/replays', (req, res) => {
    handleDeleteAllRequestReplays(req, res);
  });

  router.get('/__studio/api/logs', (req, res) => {
    handleGetLogs(req, res);
  });

  router.get('/__studio/api/logs/export', (req, res) => {
    handleExportLogs(req, res);
  });

  router.on('DELETE', '/__studio/api/logs', (req, res) => {
    handleDeleteLogs(req, res);
  });

  // ── Session Recorder ──────────────────────────────────────────────────────
  router.get('/__studio/api/session', (req, res) => {
    handleGetSession(req, res);
  });

  router.on('DELETE', '/__studio/api/session', (req, res) => {
    handleDeleteSession(req, res);
  });

  router.get('/__studio/api/session/export', (req, res) => {
    handleExportSession(req, res);
  });

  router.get('/__studio/api/session/har', (req, res) => {
    handleExportHar(req, res);
  });

  // ── Performance Observatory ───────────────────────────────────────────────
  router.get('/__studio/api/perf', (req, res) => {
    handleGetPerf(req, res);
  });

  router.on('DELETE', '/__studio/api/perf', (req, res) => {
    handleDeletePerf(req, res);
  });

  // ── SDK Impact Analyzer ───────────────────────────────────────────────────
  router.get('/__studio/api/sdk-impacts', (req, res) => {
    handleGetSdkImpacts(req, res);
  });

  router.on('DELETE', '/__studio/api/sdk-impacts', (req, res) => {
    handleDeleteAllSdkImpacts(req, res);
  });

  router.on('DELETE', '/__studio/api/sdk-impact', (req, res) => {
    handleDeleteSdkImpact(req, res);
  });

  // ── Security Center ────────────────────────────────────────────────────────
  router.get('/__studio/api/security', (req, res) => {
    handleGetSecurityReport(req, res, ctx.getApp(), ctx.getDiscovery);
  });

  router.post('/__studio/api/security/probe', (req, res) => {
    handlePostRunProbes(req, res, ctx.getApp(), ctx.getDiscovery);
  });

  // ── Contract Testing Center ────────────────────────────────────────────────
  router.get('/__studio/api/contracts', (req, res) => {
    handleGetContractResults(req, res);
  });

  router.post('/__studio/api/contracts/run', (req, res) => {
    handlePostRunContracts(req, res, ctx.getApp(), ctx.getDiscovery);
  });

  router.post('/__studio/api/contracts/toggle-autorun', (req, res) => {
    handlePostToggleAutoRun(req, res);
  });

  // ── API Quality Score ──────────────────────────────────────────────────────
  router.get('/__studio/api/quality', (req, res) => {
    handleGetQuality(req, res, ctx.getApp(), ctx.getDiscovery);
  });

  // ── AI-Powered Analysis ───────────────────────────────────────────────────
  router.get('/__studio/api/ai/status', (req, res) => {
    handleGetAiStatus(req, res, ctx.getDiscovery());
  });

  router.post('/__studio/api/ai/analyze', (req, res) => {
    handlePostAiAnalyze(req, res, ctx.getDiscovery());
  });

  router.post('/__studio/api/ai/config', (req, res) => {
    handlePostAiConfig(req, res);
  });

  // ── Studio Export & Share ──────────────────────────────────────────────────
  router.get('/__studio/api/export/html', (req, res) => {
    handleExportHtml(req, res, ctx.getApp(), ctx.getDiscovery);
  });

  router.get('/__studio/api/export/pdf', (req, res) => {
    handleExportPdf(req, res, ctx.getApp(), ctx.getDiscovery);
  });

  router.get('/__studio/api/export/markdown', (req, res) => {
    handleExportMarkdown(req, res, ctx.getApp(), ctx.getDiscovery);
  });

  // ── WebSocket Tester ───────────────────────────────────────────────────────
  router.get('/__studio/api/ws/routes', (req, res) => {
    handleGetWsRoutes(req, res, ctx.getDiscovery());
  });

  // ── Source Inspector & Error Debugger ──────────────────────────────────────
  router.post('/__studio/api/debug/source', (req, res) => {
    handlePostDebugSource(req, res);
  });

  router.post('/__studio/api/debug/frames', (req, res) => {
    handlePostDebugFrames(req, res);
  });

  // ── SDK Playground ─────────────────────────────────────────────────────────
  router.get('/__studio/api/playground/sdk', (req, res) => {
    handleGetPlaygroundSdk(req, res, ctx.getApp());
  });

  router.post('/__studio/api/playground/execute', (req, res) => {
    handlePostPlaygroundExecute(req, res, ctx.getApp());
  });
}
