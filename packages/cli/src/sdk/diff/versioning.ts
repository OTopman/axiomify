import type { BreakingChangeReport } from './breaking-changes';
import type { DiffResult } from './differ';

export class SemanticVersionEngine {
  /**
   * Suggests the next semantic version based on the breaking change analysis.
   */
  suggestNextVersion(
    currentVersion: string,
    report: BreakingChangeReport,
  ): string {
    const parts = currentVersion.split('.').map(Number);
    if (parts.length !== 3 || parts.some(isNaN)) {
      return '1.0.0'; // Fallback
    }

    let [major, minor, patch] = parts;

    if (report.isBreaking) {
      major += 1;
      minor = 0;
      patch = 0;
    } else if (report.issues.some((i) => i.severity === 'additive')) {
      minor += 1;
      patch = 0;
    } else if (report.issues.length > 0) {
      patch += 1;
    }

    return `${major}.${minor}.${patch}`;
  }
}

export class ChangelogGenerator {
  /**
   * Generates a markdown changelog from schema diffs and breaking change reports.
   */
  generate(diff: DiffResult, report: BreakingChangeReport): string {
    const lines: string[] = [];
    lines.push(`# API Change Log`);
    lines.push(`Generated on ${new Date().toISOString().split('T')[0]}`);
    lines.push();

    if (report.isBreaking) {
      lines.push(`## ⚠️ BREAKING CHANGES`);
      lines.push();
      for (const issue of report.issues.filter(
        (i) => i.severity === 'breaking',
      )) {
        lines.push(
          `- **BREAKING**: ${issue.description} (Path: \`${issue.path}\`)`,
        );
      }
      lines.push();
    }

    const additive = report.issues.filter((i) => i.severity === 'additive');
    if (additive.length > 0) {
      lines.push(`## 🚀 Additions & New Features`);
      lines.push();
      for (const issue of additive) {
        lines.push(`- **Added**: ${issue.description}`);
      }
      lines.push();
    }

    const minor = report.issues.filter((i) => i.severity === 'minor');
    if (minor.length > 0) {
      lines.push(`## 🔧 Minor Modifications & Fixes`);
      lines.push();
      for (const issue of minor) {
        lines.push(`- **Modified**: ${issue.description}`);
      }
      lines.push();
    }

    if (report.issues.length === 0) {
      lines.push(`No functional changes detected.`);
    }

    return lines.join('\n') + '\n';
  }
}

export interface MigrationStep {
  target: string;
  action: 'rename' | 'update_signature' | 'remove';
  description: string;
}

export class MigrationEngine {
  /**
   * Produces specific action items or migration steps to help client SDK consumers upgrade.
   */
  generateMigrationGuide(
    diff: DiffResult,
    report: BreakingChangeReport,
  ): MigrationStep[] {
    const steps: MigrationStep[] = [];

    // Endpoint removals/modifications
    for (const [id, epDiff] of Object.entries(diff.endpoints)) {
      if (epDiff.type === 'removed') {
        steps.push({
          target: `client.${id}`,
          action: 'remove',
          description: `The method "${id}" has been removed from the client. Identify alternatives or remove calls to it.`,
        });
      } else if (epDiff.type === 'modified') {
        const signatureChanges = epDiff.changes.filter(
          (c) =>
            c.path.startsWith('pathParams.') ||
            c.path.startsWith('queryParams.') ||
            c.path.startsWith('requestBody'),
        );
        if (signatureChanges.length > 0) {
          steps.push({
            target: `client.${id}`,
            action: 'update_signature',
            description: `The signature of method "${id}" has changed: ${signatureChanges.map((c) => `${c.path} (${c.type})`).join(', ')}.`,
          });
        }
      }
    }

    // Type removals/modifications
    for (const [id, typeDiff] of Object.entries(diff.types)) {
      if (typeDiff.type === 'removed') {
        steps.push({
          target: id,
          action: 'remove',
          description: `The interface/struct "${id}" is no longer exported by the SDK. inspect usage.`,
        });
      } else if (typeDiff.type === 'modified') {
        const removedFields = typeDiff.changes.filter(
          (c) => c.type === 'removed' && c.path.startsWith('fields.'),
        );
        for (const change of removedFields) {
          const fieldName = change.path.split('.').pop() || '';
          steps.push({
            target: `${id}.${fieldName}`,
            action: 'remove',
            description: `Field "${fieldName}" has been removed from type "${id}". Update structures that consume this type.`,
          });
        }
      }
    }

    return steps;
  }
}
