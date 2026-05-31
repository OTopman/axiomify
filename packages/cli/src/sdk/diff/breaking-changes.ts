/**
 * Breaking Change Analyzer.
 *
 * Examines a DiffResult and determines if any of the changes
 * are backwards-incompatible (breaking).
 */
import type { DiffResult, FieldChange } from './differ';

export type ChangeSeverity = 'breaking' | 'additive' | 'minor';

export interface BreakingChangeIssue {
  severity: ChangeSeverity;
  description: string;
  path: string;
}

export interface BreakingChangeReport {
  isBreaking: boolean;
  issues: BreakingChangeIssue[];
}

export class BreakingChangeAnalyzer {
  analyze(diff: DiffResult): BreakingChangeReport {
    const issues: BreakingChangeIssue[] = [];

    // 1. Endpoint Checks
    for (const [id, epDiff] of Object.entries(diff.endpoints)) {
      if (epDiff.type === 'removed') {
        issues.push({
          severity: 'breaking',
          description: `Endpoint "${id}" was removed.`,
          path: `endpoints.${id}`,
        });
      } else if (epDiff.type === 'added') {
        issues.push({
          severity: 'additive',
          description: `New endpoint "${id}" was added.`,
          path: `endpoints.${id}`,
        });
      } else if (epDiff.type === 'modified') {
        for (const change of epDiff.changes) {
          this.analyzeEndpointChange(id, change, issues);
        }
      }
    }

    // 2. Type Checks
    for (const [id, typeDiff] of Object.entries(diff.types)) {
      if (typeDiff.type === 'removed') {
        issues.push({
          severity: 'breaking',
          description: `Type "${id}" was removed.`,
          path: `types.${id}`,
        });
      } else if (typeDiff.type === 'added') {
        issues.push({
          severity: 'additive',
          description: `New type "${id}" was added.`,
          path: `types.${id}`,
        });
      } else if (typeDiff.type === 'modified') {
        for (const change of typeDiff.changes) {
          this.analyzeTypeChange(id, change, issues);
        }
      }
    }

    return {
      isBreaking: issues.some((i) => i.severity === 'breaking'),
      issues,
    };
  }

  private analyzeEndpointChange(
    endpointId: string,
    change: FieldChange,
    issues: BreakingChangeIssue[],
  ): void {
    const path = `endpoints.${endpointId}.${change.path}`;

    if (change.path === 'method') {
      issues.push({
        severity: 'breaking',
        description: `HTTP method changed from "${change.oldValue}" to "${change.newValue}" on endpoint "${endpointId}".`,
        path,
      });
      return;
    }

    if (change.path === 'path') {
      issues.push({
        severity: 'minor',
        description: `Endpoint route path changed from "${change.oldValue}" to "${change.newValue}".`,
        path,
      });
      return;
    }

    // Added/removed query/header/path params
    if (
      change.path.startsWith('queryParams.') ||
      change.path.startsWith('headerParams.') ||
      change.path.startsWith('pathParams.')
    ) {
      if (change.type === 'added') {
        const param = change.newValue as any;
        if (param?.required) {
          issues.push({
            severity: 'breaking',
            description: `Required parameter "${param.name}" was added to endpoint "${endpointId}".`,
            path,
          });
        } else {
          issues.push({
            severity: 'additive',
            description: `Optional parameter "${param?.name || ''}" was added to endpoint "${endpointId}".`,
            path,
          });
        }
      } else if (change.type === 'removed') {
        issues.push({
          severity: 'breaking',
          description: `Parameter was removed from endpoint "${endpointId}".`,
          path,
        });
      } else if (change.type === 'modified') {
        if (change.path.endsWith('.required') && change.newValue === true) {
          issues.push({
            severity: 'breaking',
            description: `Parameter on endpoint "${endpointId}" changed from optional to required.`,
            path,
          });
        } else if (change.path.endsWith('.type')) {
          issues.push({
            severity: 'breaking',
            description: `Type of parameter on endpoint "${endpointId}" was modified.`,
            path,
          });
        }
      }
      return;
    }

    // RequestBody checks
    if (change.path === 'requestBody') {
      if (change.type === 'removed') {
        issues.push({
          severity: 'minor',
          description: `RequestBody removed from endpoint "${endpointId}".`,
          path,
        });
      } else if (change.type === 'added') {
        const reqBody = change.newValue as any;
        if (reqBody?.required) {
          issues.push({
            severity: 'breaking',
            description: `Required RequestBody added to endpoint "${endpointId}".`,
            path,
          });
        }
      }
      return;
    }

    if (change.path === 'requestBody.required' && change.newValue === true) {
      issues.push({
        severity: 'breaking',
        description: `RequestBody on endpoint "${endpointId}" changed from optional to required.`,
        path,
      });
      return;
    }

    if (change.path === 'requestBody.type') {
      issues.push({
        severity: 'breaking',
        description: `RequestBody type on endpoint "${endpointId}" was modified.`,
        path,
      });
      return;
    }

    // Fallback
    issues.push({
      severity: 'minor',
      description: `Endpoint "${endpointId}" field "${change.path}" modified.`,
      path,
    });
  }

  private analyzeTypeChange(
    typeId: string,
    change: FieldChange,
    issues: BreakingChangeIssue[],
  ): void {
    const path = `types.${typeId}.${change.path}`;

    if (change.path.startsWith('fields.')) {
      if (change.type === 'removed') {
        issues.push({
          severity: 'breaking',
          description: `Field "${change.path.split('.').pop()}" was removed from type "${typeId}".`,
          path,
        });
      } else if (change.type === 'added') {
        const field = change.newValue as any;
        if (field?.required) {
          issues.push({
            severity: 'breaking',
            description: `Required field "${field.name}" was added to type "${typeId}".`,
            path,
          });
        } else {
          issues.push({
            severity: 'additive',
            description: `Optional field "${field?.name || ''}" was added to type "${typeId}".`,
            path,
          });
        }
      } else if (change.type === 'modified') {
        if (change.path.endsWith('.required') && change.newValue === true) {
          issues.push({
            severity: 'breaking',
            description: `Field on type "${typeId}" changed from optional to required.`,
            path,
          });
        } else if (change.path.endsWith('.type')) {
          issues.push({
            severity: 'breaking',
            description: `Type of field on type "${typeId}" was modified.`,
            path,
          });
        }
      }
      return;
    }

    if (change.path.startsWith('values.')) {
      if (change.type === 'removed') {
        issues.push({
          severity: 'breaking',
          description: `Enum value "${change.oldValue}" was removed from enum "${typeId}".`,
          path,
        });
      } else if (change.type === 'added') {
        issues.push({
          severity: 'additive',
          description: `Enum value "${change.newValue}" was added to enum "${typeId}".`,
          path,
        });
      }
      return;
    }

    issues.push({
      severity: 'minor',
      description: `Type "${typeId}" field "${change.path}" modified.`,
      path,
    });
  }
}
