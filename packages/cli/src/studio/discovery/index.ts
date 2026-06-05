/**
 * Discovery Orchestrator — coordinates all discovery modules and produces
 * a single {@link StudioDiscoveryResult} from a loaded Axiomify instance.
 *
 * This is the primary interface used by the Studio API layer and the
 * Live Sync engine. It caches the last discovery result so API requests
 * don't re-run discovery on every call.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import type {
  DiscoveredConfig,
  StudioDiscoveryResult,
  DiscoveredService,
  OpenApiDriftResult,
  DiscoveredEvent,
  ArchComponentNode,
} from './types';
import { discoverRoutes } from './route-discovery';
import { discoverSchemas } from './schema-discovery';
import { discoverHooks } from './hook-discovery';
import { discoverOpenApi } from './openapi-discovery';
import { discoverHealth } from './health-discovery';

export type { StudioDiscoveryResult } from './types';
export type { DiscoveredRoute } from './types';
export type { DiscoveredSchema } from './types';
export type { DiscoveredHook } from './types';
export type { DiscoveredConfig } from './types';

/**
 * Extracts framework configuration from the app instance.
 */
function discoverConfig(app: any): DiscoveredConfig {
  const httpRoutes = app.registeredRoutes ?? [];
  const wsRoutes = app.registeredWsRoutes ?? [];
  const socketIoRoutes = app.registeredSocketIoRoutes ?? [];

  // Hook count is the sum of all hook arrays.
  const hooks = app.hooks?.hooks;
  let hookCount = 0;
  if (hooks && typeof hooks === 'object') {
    for (const list of Object.values(hooks)) {
      if (Array.isArray(list)) hookCount += list.length;
    }
  }

  // Service count — app._services is a private Map. We access it carefully
  // and gracefully degrade if the internal structure changes.
  let serviceCount = 0;
  try {
    const services = (app as any)._services;
    if (services && typeof services.size === 'number') {
      serviceCount = services.size;
    }
  } catch {
    // Access to _services not possible — report 0.
  }

  return {
    timeout: typeof app.timeout === 'number' ? app.timeout : 0,
    routeConflict: app.routeConflict ?? 'throw',
    strictSchema: app.strictSchema ?? false,
    httpRouteCount: httpRoutes.length,
    wsRouteCount: wsRoutes.length + socketIoRoutes.length,
    socketIoRouteCount: socketIoRoutes.length,
    hookCount,
    serviceCount,
  };
}

function getServiceMethods(value: any): string[] {
  if (!value || (typeof value !== 'object' && typeof value !== 'function')) {
    return [];
  }
  const methods = new Set<string>();
  let proto = value;
  while (proto && proto !== Object.prototype) {
    for (const key of Object.getOwnPropertyNames(proto)) {
      if (
        key !== 'constructor' &&
        !key.startsWith('_') &&
        typeof (value as any)[key] === 'function'
      ) {
        methods.add(key);
      }
    }
    proto = Object.getPrototypeOf(proto);
  }
  return Array.from(methods);
}

function discoverServices(app: any): DiscoveredService[] {
  const discovered: DiscoveredService[] = [];
  try {
    const servicesMap = app._services;
    if (servicesMap instanceof Map) {
      for (const [token, value] of servicesMap.entries()) {
        const tokenStr =
          typeof token === 'symbol'
            ? token.description || token.toString()
            : String(token);

        let typeStr = 'unknown';
        if (value && typeof value === 'object') {
          if (
            value.constructor &&
            value.constructor.name &&
            value.constructor.name !== 'Object'
          ) {
            typeStr = value.constructor.name;
          } else {
            typeStr = 'Object';
          }
        } else {
          typeStr = typeof value;
        }

        const methods = getServiceMethods(value);
        discovered.push({
          token: tokenStr,
          type: typeStr,
          methods,
        });
      }
    }
  } catch (err) {
    // Gracefully degrade
  }
  return discovered;
}

function checkOpenApiDrift(liveSpec: any): OpenApiDriftResult {
  const filePath = path.resolve(process.cwd(), 'openapi.json');
  const hasFile = fs.existsSync(filePath);
  if (!hasFile) {
    return {
      hasFile: false,
      synced: false,
      diffs: ['Local openapi.json file does not exist.'],
    };
  }

  try {
    const fileContent = fs.readFileSync(filePath, 'utf8');
    const localSpec = JSON.parse(fileContent);
    const diffs: string[] = [];

    const livePaths = liveSpec?.paths || {};
    const localPaths = localSpec?.paths || {};

    for (const pathKey of Object.keys(livePaths)) {
      if (!localPaths[pathKey]) {
        diffs.push(
          `Path "${pathKey}" exists in live API but is missing in local openapi.json.`,
        );
        continue;
      }
      const liveMethods = livePaths[pathKey] || {};
      const localMethods = localPaths[pathKey] || {};
      for (const method of Object.keys(liveMethods)) {
        if (!localMethods[method]) {
          diffs.push(
            `Method "${method.toUpperCase()} ${pathKey}" exists in live API but is missing in local openapi.json.`,
          );
        }
      }
    }

    for (const pathKey of Object.keys(localPaths)) {
      if (!livePaths[pathKey]) {
        diffs.push(
          `Path "${pathKey}" exists in local openapi.json but is missing in live API.`,
        );
        continue;
      }
      const liveMethods = livePaths[pathKey] || {};
      const localMethods = localPaths[pathKey] || {};
      for (const method of Object.keys(localMethods)) {
        if (!liveMethods[method]) {
          diffs.push(
            `Method "${method.toUpperCase()} ${pathKey}" exists in local openapi.json but is missing in live API.`,
          );
        }
      }
    }

    if (liveSpec?.info?.title !== localSpec?.info?.title) {
      diffs.push(
        `API Title drift: Live "${liveSpec?.info?.title || ''}" vs Local "${localSpec?.info?.title || ''}"`,
      );
    }
    if (liveSpec?.info?.version !== localSpec?.info?.version) {
      diffs.push(
        `API Version drift: Live "${liveSpec?.info?.version || ''}" vs Local "${localSpec?.info?.version || ''}"`,
      );
    }

    return {
      hasFile: true,
      synced: diffs.length === 0,
      diffs,
    };
  } catch (err: any) {
    return {
      hasFile: true,
      synced: false,
      diffs: [`Error parsing local openapi.json: ${err.message}`],
    };
  }
}

function discoverEvents(app: any): DiscoveredEvent[] {
  const discovered: DiscoveredEvent[] = [];
  try {
    const servicesMap = app._services;
    if (servicesMap instanceof Map) {
      for (const [token, value] of servicesMap.entries()) {
        if (
          value &&
          typeof value === 'object' &&
          typeof value.eventNames === 'function'
        ) {
          const tokenStr =
            typeof token === 'symbol'
              ? token.description || token.toString()
              : String(token);
          const events = value.eventNames();
          for (const ev of events) {
            const evStr = String(ev);
            const count =
              typeof value.listenerCount === 'function'
                ? value.listenerCount(ev)
                : 0;
            const listenersList =
              typeof value.listeners === 'function' ? value.listeners(ev) : [];
            const listeners = listenersList.map(
              (f: any) => f.name || 'anonymous',
            );
            discovered.push({
              emitterToken: tokenStr,
              event: evStr,
              listenerCount: count,
              listeners,
            });
          }
        }
      }
    }
  } catch (err) {
    // Gracefully degrade
  }
  return discovered;
}

function getServiceDependencies(service: any, allTokens: string[]): string[] {
  if (!service || typeof service !== 'object') return [];
  const deps = new Set<string>();
  try {
    const proto = Object.getPrototypeOf(service);
    if (proto && proto.constructor) {
      const source = proto.constructor.toString();
      for (const tok of allTokens) {
        if (source.includes(tok) && tok !== service.constructor?.name) {
          deps.add(tok);
        }
      }
    }
    for (const key of Object.getOwnPropertyNames(proto)) {
      if (key !== 'constructor' && typeof service[key] === 'function') {
        const source = service[key].toString();
        for (const tok of allTokens) {
          if (source.includes(tok)) {
            deps.add(tok);
          }
        }
      }
    }
  } catch {
    // Ignore
  }
  return Array.from(deps);
}

function discoverArchMap(app: any, routes: any[]): ArchComponentNode[] {
  const nodes: ArchComponentNode[] = [];
  const serviceTokens: string[] = [];
  const tokenToService = new Map<string, any>();

  try {
    const servicesMap = app._services;
    if (servicesMap instanceof Map) {
      for (const [token, value] of servicesMap.entries()) {
        const tokenStr =
          typeof token === 'symbol'
            ? token.description || token.toString()
            : String(token);
        serviceTokens.push(tokenStr);
        tokenToService.set(tokenStr, value);
      }
    }
  } catch {}

  for (const token of serviceTokens) {
    const value = tokenToService.get(token);
    let type: 'service' | 'repository' | 'database' = 'service';

    let constructorName = '';
    if (value && typeof value === 'object') {
      constructorName = value.constructor?.name || '';
    }

    const lowerToken = token.toLowerCase();
    const lowerName = constructorName.toLowerCase();

    if (
      lowerToken.includes('db') ||
      lowerToken.includes('prisma') ||
      lowerToken.includes('mongoose') ||
      lowerToken.includes('database') ||
      lowerName.includes('prismaclient') ||
      lowerName.includes('mongoose') ||
      lowerName.includes('database')
    ) {
      type = 'database';
    } else if (
      lowerToken.endsWith('repository') ||
      lowerName.endsWith('repository')
    ) {
      type = 'repository';
    } else if (
      lowerToken.endsWith('service') ||
      lowerName.endsWith('service')
    ) {
      type = 'service';
    }

    const dependencies = getServiceDependencies(value, serviceTokens);

    nodes.push({
      id: `service:${token}`,
      label: token,
      type,
      dependencies: dependencies.map((dep) => `service:${dep}`),
    });
  }

  for (const r of routes) {
    const routeId = `controller:${r.method}:${r.path}`;
    const dependencies: string[] = [];

    try {
      const match = app.dispatcher?.router?.lookup(r.method, r.path, {});
      if (match && match.route && match.route.handler) {
        const source = match.route.handler.toString();
        for (const tok of serviceTokens) {
          if (source.includes(tok)) {
            dependencies.push(`service:${tok}`);
          }
        }
      }
    } catch {}

    nodes.push({
      id: routeId,
      label: `${r.method} ${r.path}`,
      type: 'controller',
      dependencies,
    });
  }

  return nodes;
}

/**
 * Performs a full discovery run against the loaded Axiomify app instance.
 *
 * This function is idempotent — calling it multiple times with the same
 * app instance produces the same result. It does NOT modify the app.
 */
export async function performDiscovery(
  app: any,
): Promise<StudioDiscoveryResult> {
  const [routes, schemas, hooks, config, openapi, health] = await Promise.all([
    Promise.resolve(discoverRoutes(app)),
    Promise.resolve(discoverSchemas(app)),
    Promise.resolve(discoverHooks(app)),
    Promise.resolve(discoverConfig(app)),
    discoverOpenApi(app),
    Promise.resolve(discoverHealth(app)),
  ]);

  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue;
    const upperKey = key.toUpperCase();
    const isSensitive = [
      'SECRET',
      'PASSWORD',
      'TOKEN',
      'KEY',
      'AUTH',
      'PASS',
      'CREDENTIAL',
      'PWD',
    ].some((word) => upperKey.includes(word));
    env[key] = isSensitive ? '••••••••' : value;
  }

  const services = discoverServices(app);
  const drift = checkOpenApiDrift(openapi);
  const events = discoverEvents(app);
  const archMap = discoverArchMap(app, routes);

  return {
    routes,
    schemas,
    hooks,
    config,
    openapi,
    health,
    env,
    services,
    drift,
    events,
    archMap,
    discoveredAt: new Date().toISOString(),
  };
}
