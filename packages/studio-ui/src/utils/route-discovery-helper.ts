import { RouteItem } from '../types';

export interface RouteMetadata {
  summary: string;
  description: string;
  tags: string[];
  operationId: string;
}

export interface TagWithCount {
  tag: string;
  count: number;
}

/**
 * Extracts and normalises route metadata (summary, description, tags, operationId)
 * from the route item, falling back to OpenAPI specification if needed.
 */
export function getRouteMetadata(
  route: RouteItem,
  openapi?: any,
): RouteMetadata {
  const methodLower = route.method.toLowerCase();
  const openapiOp = openapi?.paths?.[route.path]?.[methodLower];

  const summary =
    (typeof route.summary === 'string' && route.summary.trim()) ||
    (typeof openapiOp?.summary === 'string' && openapiOp.summary.trim()) ||
    '';

  const description =
    (typeof route.description === 'string' && route.description.trim()) ||
    (typeof openapiOp?.description === 'string' &&
      openapiOp.description.trim()) ||
    '';

  const tagsSet = new Set<string>();
  if (Array.isArray(route.tags)) {
    route.tags.forEach((t) => t && tagsSet.add(String(t).trim()));
  }
  if (Array.isArray(openapiOp?.tags)) {
    openapiOp.tags.forEach((t: any) => t && tagsSet.add(String(t).trim()));
  }

  const operationId =
    (typeof route.operationId === 'string' && route.operationId.trim()) ||
    (typeof openapiOp?.operationId === 'string' &&
      openapiOp.operationId.trim()) ||
    '';

  return {
    summary,
    description,
    tags: Array.from(tagsSet),
    operationId,
  };
}

/**
 * Filters discovered routes by query string, HTTP method, and tag.
 */
export function filterRoutes(
  routes: RouteItem[],
  options: {
    query?: string;
    method?: string;
    tag?: string;
    openapi?: any;
    excludeWs?: boolean;
  },
): RouteItem[] {
  const {
    query = '',
    method = 'ALL',
    tag = 'ALL',
    openapi,
    excludeWs = true,
  } = options;
  const cleanQuery = query.trim().toLowerCase();
  const cleanMethod = method.trim().toUpperCase();
  const cleanTag = tag.trim().toLowerCase();

  return routes.filter((route) => {
    if (excludeWs && route.isWs) return false;

    // Method filter
    if (cleanMethod !== 'ALL' && route.method.toUpperCase() !== cleanMethod) {
      return false;
    }

    const meta = getRouteMetadata(route, openapi);

    // Tag filter
    if (cleanTag !== 'all') {
      const hasTag = meta.tags.some((t) => t.toLowerCase() === cleanTag);
      if (!hasTag) return false;
    }

    // Query filter
    if (cleanQuery) {
      const matchPath = route.path.toLowerCase().includes(cleanQuery);
      const matchMethod = route.method.toLowerCase().includes(cleanQuery);
      const matchSummary = meta.summary.toLowerCase().includes(cleanQuery);
      const matchDescription = meta.description
        .toLowerCase()
        .includes(cleanQuery);
      const matchTags = meta.tags.some((t) =>
        t.toLowerCase().includes(cleanQuery),
      );
      const matchOpId = meta.operationId.toLowerCase().includes(cleanQuery);

      if (
        !matchPath &&
        !matchMethod &&
        !matchSummary &&
        !matchDescription &&
        !matchTags &&
        !matchOpId
      ) {
        return false;
      }
    }

    return true;
  });
}

/**
 * Extracts all unique tags from routes along with their occurrence count.
 */
export function extractAllTags(
  routes: RouteItem[],
  openapi?: any,
): TagWithCount[] {
  const map = new Map<string, number>();

  for (const route of routes) {
    if (route.isWs) continue;
    const meta = getRouteMetadata(route, openapi);
    for (const t of meta.tags) {
      map.set(t, (map.get(t) || 0) + 1);
    }
  }

  return Array.from(map.entries())
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

/**
 * Computes route counts grouped by HTTP method.
 */
export function extractMethodCounts(
  routes: RouteItem[],
): Record<string, number> {
  const counts: Record<string, number> = {
    ALL: 0,
    GET: 0,
    POST: 0,
    PUT: 0,
    DELETE: 0,
    PATCH: 0,
  };

  for (const r of routes) {
    if (r.isWs) continue;
    counts.ALL = (counts.ALL || 0) + 1;
    const m = r.method.toUpperCase();
    counts[m] = (counts[m] || 0) + 1;
  }

  return counts;
}
