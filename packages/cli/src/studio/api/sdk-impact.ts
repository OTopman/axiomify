import type { ServerResponse } from 'node:http';
import { sendJson } from '../server/http-server';
import type { StudioDiscoveryResult, DiscoveredRoute, DiscoveredSchema } from '../discovery/types';

export interface SdkImpact {
  id: string;
  route: string;
  method: string;
  changeType: 'breaking' | 'non-breaking' | 'patch' | 'new' | 'removed';
  affectedSdks: ('typescript' | 'python' | 'dart')[];
  details: string[];
  timestamp: string;
}

export let pendingImpacts: SdkImpact[] = [];
let baselineDiscovery: StudioDiscoveryResult | null = null;

export function setBaselineDiscovery(discovery: StudioDiscoveryResult): void {
  baselineDiscovery = discovery;
}

/**
 * Diff two JSON schemas recursively and return list of changes.
 */
function diffJsonSchema(
  pathPrefix: string,
  before: any,
  after: any,
  isResponse: boolean
): { changeType: 'breaking' | 'non-breaking' | 'patch'; detail: string }[] {
  const changes: { changeType: 'breaking' | 'non-breaking' | 'patch'; detail: string }[] = [];

  if (!before || !after) return changes;

  // 1. Type mismatch
  if (before.type !== after.type) {
    changes.push({
      changeType: 'breaking',
      detail: `Type of "${pathPrefix}" changed from ${before.type || 'any'} to ${after.type || 'any'}`
    });
    return changes;
  }

  // 2. Object properties comparison
  if (before.type === 'object' || before.properties) {
    const beforeProps = before.properties || {};
    const afterProps = after.properties || {};
    const afterRequired = Array.isArray(after.required) ? after.required : [];

    // Deleted properties
    for (const key of Object.keys(beforeProps)) {
      if (!(key in afterProps)) {
        changes.push({
          changeType: 'breaking',
          detail: `Field "${pathPrefix ? `${pathPrefix}.${key}` : key}" was removed`
        });
      }
    }

    // Added properties
    for (const key of Object.keys(afterProps)) {
      if (!(key in beforeProps)) {
        const isReq = afterRequired.includes(key);
        if (isReq && !isResponse) {
          changes.push({
            changeType: 'breaking',
            detail: `Required field "${pathPrefix ? `${pathPrefix}.${key}` : key}" was added`
          });
        } else {
          changes.push({
            changeType: 'non-breaking',
            detail: `Optional field "${pathPrefix ? `${pathPrefix}.${key}` : key}" was added`
          });
        }
      }
    }

    // Common properties
    for (const key of Object.keys(beforeProps)) {
      if (key in afterProps) {
        const nestedChanges = diffJsonSchema(
          pathPrefix ? `${pathPrefix}.${key}` : key,
          beforeProps[key],
          afterProps[key],
          isResponse
        );
        changes.push(...nestedChanges);
      }
    }
  }

  // 3. Array items comparison
  if (before.type === 'array' && before.items && after.items) {
    const nestedChanges = diffJsonSchema(
      `${pathPrefix}[]`,
      before.items,
      after.items,
      isResponse
    );
    changes.push(...nestedChanges);
  }

  return changes;
}

/**
 * Compare old and new discovery and push impacts to store.
 */
export function computeImpacts(newDiscovery: StudioDiscoveryResult): void {
  if (!baselineDiscovery) {
    baselineDiscovery = newDiscovery;
    return;
  }

  const before = baselineDiscovery;
  const after = newDiscovery;

  const oldRoutesMap = new Map<string, DiscoveredRoute>(before.routes.map(r => [`${r.method.toUpperCase()}:${r.path}`, r]));
  const newRoutesMap = new Map<string, DiscoveredRoute>(after.routes.map(r => [`${r.method.toUpperCase()}:${r.path}`, r]));

  const oldSchemasMap = new Map<string, DiscoveredSchema>(before.schemas.map(s => [s.routeId || `${s.method.toUpperCase()}:${s.path}`, s]));
  const newSchemasMap = new Map<string, DiscoveredSchema>(after.schemas.map(s => [s.routeId || `${s.method.toUpperCase()}:${s.path}`, s]));

  const detected: SdkImpact[] = [];
  const affectedSdks: ('typescript' | 'python' | 'dart')[] = ['typescript', 'python', 'dart'];

  // 1. Detect removed routes
  for (const [key, r] of oldRoutesMap.entries()) {
    if (!newRoutesMap.has(key)) {
      detected.push({
        id: `impact-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
        route: r.path,
        method: r.method,
        changeType: 'removed',
        affectedSdks,
        details: [`Route ${r.method} ${r.path} was deleted`],
        timestamp: new Date().toISOString()
      });
    }
  }

  // 2. Detect new or changed routes
  for (const [key, r] of newRoutesMap.entries()) {
    const oldRoute = oldRoutesMap.get(key);

    if (!oldRoute) {
      // New route added
      detected.push({
        id: `impact-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
        route: r.path,
        method: r.method,
        changeType: 'new',
        affectedSdks,
        details: [`Route ${r.method} ${r.path} was added`],
        timestamp: new Date().toISOString()
      });
      continue;
    }

    // Route exists in both, check metadata & schemas
    const details: string[] = [];
    let changeType: SdkImpact['changeType'] = 'patch';

    // Metadata changes
    if (r.deprecated && !oldRoute.deprecated) {
      details.push('Route marked as deprecated');
      changeType = 'patch';
    }
    if (r.timeout !== oldRoute.timeout) {
      details.push(`Timeout changed from ${oldRoute.timeout ?? 'default'} to ${r.timeout ?? 'default'}`);
      changeType = 'patch';
    }
    if (r.operationId !== oldRoute.operationId) {
      details.push(`operationId changed from "${oldRoute.operationId || 'none'}" to "${r.operationId || 'none'}"`);
      changeType = 'patch';
    }

    // Schema changes
    const oldSchema = oldSchemasMap.get(key);
    const newSchema = newSchemasMap.get(key);

    const schemaTargets: { type: 'body' | 'query' | 'params' | 'response' | 'message'; label: string; isResponse: boolean }[] = [
      { type: 'body', label: 'Body Request Schema', isResponse: false },
      { type: 'query', label: 'Query Parameter Schema', isResponse: false },
      { type: 'params', label: 'Path Parameter Schema', isResponse: false },
      { type: 'response', label: 'Response Schema', isResponse: true },
      { type: 'message', label: 'WS Message Schema', isResponse: false }
    ];

    for (const target of schemaTargets) {
      const oldVal = oldSchema ? (oldSchema as any)[target.type] : null;
      const newVal = newSchema ? (newSchema as any)[target.type] : null;

      if (oldVal && !newVal) {
        details.push(`${target.label} was removed`);
        changeType = 'breaking';
      } else if (!oldVal && newVal) {
        const hasReq = Array.isArray(newVal.required) && newVal.required.length > 0;
        if (hasReq && !target.isResponse) {
          details.push(`${target.label} was added with required fields`);
          changeType = 'breaking';
        } else {
          details.push(`${target.label} was added`);
          changeType = 'non-breaking';
        }
      } else if (oldVal && newVal) {
        const schemaChanges = diffJsonSchema('', oldVal, newVal, target.isResponse);
        for (const change of schemaChanges) {
          details.push(`[${target.type}] ${change.detail}`);
          if (change.changeType === 'breaking') {
            changeType = 'breaking';
          } else if (change.changeType === 'non-breaking' && changeType !== 'breaking') {
            changeType = 'non-breaking';
          }
        }
      }
    }

    if (details.length > 0) {
      detected.push({
        id: `impact-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
        route: r.path,
        method: r.method,
        changeType,
        affectedSdks,
        details,
        timestamp: new Date().toISOString()
      });
    }
  }

  // Update pending impacts
  pendingImpacts.push(...detected);

  // Update baseline to the new discovery snapshot
  baselineDiscovery = newDiscovery;
}

export function handleGetSdkImpacts(_req: any, res: ServerResponse): void {
  sendJson(res, { impacts: pendingImpacts });
}

export function handleDeleteSdkImpact(req: any, res: ServerResponse): void {
  const url = new URL(req.url ?? '', 'http://localhost');
  const id = url.searchParams.get('id');

  if (id) {
    pendingImpacts = pendingImpacts.filter(i => i.id !== id);
  }
  sendJson(res, { success: true });
}

export function handleDeleteAllSdkImpacts(_req: any, res: ServerResponse): void {
  pendingImpacts = [];
  sendJson(res, { success: true });
}
