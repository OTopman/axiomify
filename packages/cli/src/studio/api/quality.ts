import type { ServerResponse } from 'node:http';
import { sendJson } from '../server/http-server';
import type { StudioDiscoveryResult } from '../discovery/types';
import { getRouteLatenciesMap } from './perf';
import { getSecurityFindings } from './security';
import { getContractResults } from './contracts';

export interface RouteQuality {
  route: string;
  method: string;
  score: number;
  issues: string[];
}

export interface QualityReport {
  total: number;
  dimensions: {
    schemaCoverage: { score: number; weight: number; detail: string };
    documentation: { score: number; weight: number; detail: string };
    performance: { score: number; weight: number; detail: string };
    security: { score: number; weight: number; detail: string };
    contractCompliance: { score: number; weight: number; detail: string };
  };
  perRoute: RouteQuality[];
  resetAt: string;
}

let qualityHistory: { timestamp: string; score: number }[] = [];
const statsResetAt = new Date().toISOString();

export function getQualityHistory(): { timestamp: string; score: number }[] {
  // If history is empty, initialize it with a baseline
  if (qualityHistory.length === 0) {
    qualityHistory.push({ timestamp: statsResetAt, score: 100 });
  }
  return qualityHistory;
}

export function recordQualityHistoryEntry(score: number): void {
  // Prevent duplicate consecutive entries with identical scores at identical minutes
  const now = new Date().toISOString();
  const last = qualityHistory[qualityHistory.length - 1];
  if (last && Math.round(last.score) === Math.round(score) && now.substring(0, 16) === last.timestamp.substring(0, 16)) {
    return;
  }
  
  qualityHistory.push({
    timestamp: now,
    score: Math.round(score),
  });
  if (qualityHistory.length > 10) {
    qualityHistory.shift();
  }
}

/**
 * Computes the composite quality score for the API surface.
 */
export function computeQualityScore(
  discovery: StudioDiscoveryResult,
  app: any,
): QualityReport {
  const httpRoutes = discovery.routes.filter((r) => !r.isWs);
  const totalHttpRoutes = httpRoutes.length;

  // 1. Schema Coverage (25%)
  let schemaCoverageScore = 100;
  let schemaDetail = 'All routes have schemas';
  if (totalHttpRoutes > 0) {
    const mutatingRoutes = httpRoutes.filter((r) =>
      ['POST', 'PUT', 'PATCH', 'DELETE'].includes(r.method),
    );
    const inputCount = mutatingRoutes.length;
    let inputCoverage = 1.0;
    if (inputCount > 0) {
      const inputWithSchema = mutatingRoutes.filter(
        (r) => r.validation && r.validation.length > 0,
      ).length;
      inputCoverage = inputWithSchema / inputCount;
    }

    const responseWithSchema = httpRoutes.filter((r) => r.hasResponseSchema).length;
    const responseCoverage = responseWithSchema / totalHttpRoutes;

    schemaCoverageScore = Math.round(((inputCoverage + responseCoverage) / 2) * 100);
    schemaDetail = `${Math.round(responseCoverage * 100)}% response schemas, ${Math.round(inputCoverage * 100)}% mutating input schemas`;
  }

  // 2. Documentation (20%)
  let docScore = 100;
  let docDetail = 'All routes are documented';
  if (totalHttpRoutes > 0) {
    let totalDocPoints = 0;
    for (const r of httpRoutes) {
      let routePoints = 0;
      if (r.tags && r.tags.length > 0) routePoints += 30;
      if (r.summary && r.summary.trim().length > 0) routePoints += 30;
      if (r.description && r.description.trim().length > 0) routePoints += 40;
      totalDocPoints += routePoints;
    }
    docScore = Math.round(totalDocPoints / totalHttpRoutes);
    docDetail = `Documentation score averaged across ${totalHttpRoutes} HTTP routes`;
  }

  // 3. Performance (20%)
  let perfScore = 100;
  let perfDetail = 'No latency measurements yet (defaults to 100)';
  if (totalHttpRoutes > 0) {
    const routeLatencies = getRouteLatenciesMap();
    const ratedRoutes = [];
    for (const r of httpRoutes) {
      const bucket = routeLatencies.get(`${r.method}:${r.path}`);
      if (bucket && bucket.count > 0) {
        let routeScore = 10;
        if (bucket.p95 <= 200) routeScore = 100;
        else if (bucket.p95 <= 500) routeScore = 70;
        else if (bucket.p95 <= 1000) routeScore = 40;
        ratedRoutes.push(routeScore);
      }
    }
    if (ratedRoutes.length > 0) {
      perfScore = Math.round(ratedRoutes.reduce((a, b) => a + b, 0) / ratedRoutes.length);
      perfDetail = `Based on P95 latency measurements for ${ratedRoutes.length} route(s)`;
    }
  }

  // 4. Security (20%)
  const findings = getSecurityFindings();
  let securityScore = 100;
  let securityDetail = 'No security issues found';
  if (findings.length > 0) {
    let deductions = 0;
    for (const f of findings) {
      if (f.severity === 'critical') deductions += 25;
      else if (f.severity === 'high') deductions += 15;
      else if (f.severity === 'medium') deductions += 10;
      else if (f.severity === 'low') deductions += 5;
    }
    securityScore = Math.max(0, 100 - deductions);
    securityDetail = `${findings.length} security finding(s) active (${findings.filter(f => f.severity === 'critical').length} critical)`;
  }

  // 5. Contract Compliance (15%)
  const contractResults = getContractResults();
  let contractScore = 100;
  let contractDetail = 'No contract tests run yet (defaults to 100)';
  if (contractResults.length > 0) {
    const testedRoutes = contractResults.filter(
      (c) => c.status !== 'missing-schema',
    );
    if (testedRoutes.length > 0) {
      const passed = testedRoutes.filter((c) => c.passed).length;
      contractScore = Math.round((passed / testedRoutes.length) * 100);
      contractDetail = `${passed} of ${testedRoutes.length} schema-defined routes passing response contract checks`;
    } else {
      contractDetail = 'tested routes lack response schemas';
    }
  }

  // Composite Total Score
  const totalScore = Math.round(
    schemaCoverageScore * 0.25 +
      docScore * 0.20 +
      perfScore * 0.20 +
      securityScore * 0.20 +
      contractScore * 0.15,
  );

  recordQualityHistoryEntry(totalScore);

  // Compute issues per-route
  const perRoute: RouteQuality[] = [];
  const routeLatencies = getRouteLatenciesMap();
  for (const r of httpRoutes) {
    const routeId = `${r.method}:${r.path}`;
    const issues: string[] = [];
    let rScore = 100;

    // Check schema coverage issues
    if (!r.hasResponseSchema) {
      issues.push('Missing response schema');
      rScore -= 20;
    }
    const isMutating = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(r.method);
    if (isMutating && (!r.validation || r.validation.length === 0)) {
      issues.push('Missing mutating input validation schema');
      rScore -= 20;
    }

    // Check documentation issues
    if (!r.tags || r.tags.length === 0) {
      issues.push('Missing tags / OpenAPI tags');
      rScore -= 10;
    }
    if (!r.summary || r.summary.trim().length === 0) {
      issues.push('Missing OpenAPI summary');
      rScore -= 10;
    }
    if (!r.description || r.description.trim().length === 0) {
      issues.push('Missing OpenAPI description');
      rScore -= 10;
    }

    // Check performance issues
    const perfBucket = routeLatencies.get(routeId);
    if (perfBucket && perfBucket.count > 0) {
      if (perfBucket.p95 > 500) {
        issues.push(`Slow route: P95 latency is ${perfBucket.p95}ms (exceeds 500ms target)`);
        rScore -= 20;
      }
    }

    // Check security issues
    const routeFindings = findings.filter(
      (f) => f.route === r.path && f.method === r.method,
    );
    for (const f of routeFindings) {
      issues.push(`Security issue (${f.severity}): ${f.title}`);
      if (f.severity === 'critical') rScore -= 30;
      else if (f.severity === 'high') rScore -= 20;
      else rScore -= 10;
    }

    // Check contract issues
    const contract = contractResults.find((c) => c.routeId === routeId);
    if (contract && !contract.passed && contract.status !== 'missing-schema') {
      issues.push(`Contract violation: ${contract.violations.join('; ')}`);
      rScore -= 25;
    }

    perRoute.push({
      route: r.path,
      method: r.method,
      score: Math.max(0, rScore),
      issues,
    });
  }

  return {
    total: totalScore,
    dimensions: {
      schemaCoverage: {
        score: schemaCoverageScore,
        weight: 25,
        detail: schemaDetail,
      },
      documentation: { score: docScore, weight: 20, detail: docDetail },
      performance: { score: perfScore, weight: 20, detail: perfDetail },
      security: { score: securityScore, weight: 20, detail: securityDetail },
      contractCompliance: {
        score: contractScore,
        weight: 15,
        detail: contractDetail,
      },
    },
    perRoute,
    resetAt: statsResetAt,
  };
}

// ─── HTTP Handlers ────────────────────────────────────────────────────────────

export function handleGetQuality(
  req: any,
  res: ServerResponse,
  app: any,
  getDiscovery: () => StudioDiscoveryResult,
): void {
  const discovery = getDiscovery();
  const report = computeQualityScore(discovery, app);
  sendJson(res, {
    report,
    history: getQualityHistory(),
  });
}
