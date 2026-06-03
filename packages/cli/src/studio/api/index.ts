/**
 * Studio API — route registrar.
 *
 * Registers all Studio API endpoints on the {@link StudioRouter}.
 * Each handler receives the cached {@link StudioDiscoveryResult}
 * via closure, so discovery runs once and all endpoints share the same
 * snapshot until the next live-sync reload.
 */
import type { StudioDiscoveryResult } from '../discovery';
import { StudioRouter } from '../server/router';
import { sendJson } from '../server/http-server';
import { handleGetRoutes } from './routes';
import { handleGetSchemas } from './schemas';
import { handleGetHooks } from './hooks';
import { handleGetConfig } from './config';
import { handleGetOpenApi, handlePostOpenApiSync } from './openapi';
import { handleGetHealth } from './health';
import { handlePostRequest } from './request';
import { handleGetSystem } from './system';
import { handleGetErrors } from './errors';
import { handleGetWsAnalytics } from './ws-analytics';
import { handlePostRequestReplay, handleGetRequestReplays, handleDeleteRequestReplay, handleDeleteAllRequestReplays } from './replay';

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

  router.post('/__studio/api/request', (req, res) => {
    handlePostRequest(req, res, ctx.getApp());
  });

  router.get('/__studio/api/errors', (req, res) => {
    handleGetErrors(req, res);
  });

  router.get('/__studio/api/ws-analytics', (req, res) => {
    handleGetWsAnalytics(req, res);
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
}
