/**
 * Breaking Change Analyzer.
 *
 * Examines a DiffResult and determines if any of the changes
 * are backwards-incompatible (breaking).
 */
import type { DiffResult, EndpointDiff, TypeDiff } from './differ';

export type ChangeSeverity = 'breaking' | 'additive' | 'minor';

export interface BreakingChangeReport {
  isBreaking: boolean;
  issues: BreakingChangeIssue[];
}

export interface BreakingChangeIssue {
  severity: ChangeSeverity;
  description: string;
}

export class BreakingChangeAnalyzer {
  analyze(diff: DiffResult): BreakingChangeReport {
    const issues: BreakingChangeIssue[] = [];

    // Removed endpoints are always breaking
    for (const [id, epDiff] of Object.entries(diff.endpoints)) {
      if (epDiff.type === 'removed') {
        issues.push({ severity: 'breaking', description: `Endpoint removed: ${id}` });
      } else if (epDiff.type === 'added') {
        issues.push({ severity: 'additive', description: `Endpoint added: ${id}` });
      } else if (epDiff.type === 'modified') {
        // Checking for breaking changes within modified endpoints (e.g. added required param)
        // is complex, but this is the hook for it.
        issues.push({ severity: 'minor', description: `Endpoint modified: ${id}` });
      }
    }

    // Removed types that are still referenced would be caught by SemanticAnalyzer,
    // but just in case:
    for (const [id, typeDiff] of Object.entries(diff.types)) {
      if (typeDiff.type === 'removed') {
         issues.push({ severity: 'breaking', description: `Type removed: ${id}` });
      }
    }

    return {
      isBreaking: issues.some(i => i.severity === 'breaking'),
      issues,
    };
  }
}
