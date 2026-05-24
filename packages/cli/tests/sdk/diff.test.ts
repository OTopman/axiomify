import { describe, it, expect } from 'vitest';
import { SchemaDiffer } from '../../src/sdk/diff/differ';
import { BreakingChangeAnalyzer } from '../../src/sdk/diff/breaking-changes';
import { IRSchema } from '../../src/sdk/ir/types';

describe('SchemaDiffer and BreakingChangeAnalyzer', () => {
  it('should detect added endpoints as non-breaking', () => {
    const oldSchema: IRSchema = {
      info: { title: 'Test API', version: '1.0.0' },
      types: new Map(),
      endpoints: []
    };

    const newSchema: IRSchema = {
      info: { title: 'Test API', version: '1.0.0' },
      types: new Map(),
      endpoints: [
        {
          operationId: 'getUsers',
          method: 'GET',
          path: '/users',
          description: '',
          parameters: [],
          responses: []
        }
      ]
    };

    const differ = new SchemaDiffer();
    const diff = differ.diff(oldSchema, newSchema);

    expect(diff.endpoints['getUsers']).toBeDefined();
    expect(diff.endpoints['getUsers'].type).toBe('added');

    const analyzer = new BreakingChangeAnalyzer();
    const report = analyzer.analyze(diff);

    expect(report.isBreaking).toBe(false);
    expect(report.issues).toHaveLength(1);
    expect(report.issues[0].severity).toBe('additive');
  });

  it('should detect removed endpoints as breaking', () => {
    const oldSchema: IRSchema = {
      info: { title: 'Test API', version: '1.0.0' },
      types: new Map(),
      endpoints: [
        {
          operationId: 'getUsers',
          method: 'GET',
          path: '/users',
          description: '',
          parameters: [],
          responses: []
        }
      ]
    };

    const newSchema: IRSchema = {
      info: { title: 'Test API', version: '1.0.0' },
      types: new Map(),
      endpoints: []
    };

    const differ = new SchemaDiffer();
    const diff = differ.diff(oldSchema, newSchema);

    expect(diff.endpoints['getUsers'].type).toBe('removed');

    const analyzer = new BreakingChangeAnalyzer();
    const report = analyzer.analyze(diff);

    expect(report.isBreaking).toBe(true);
    expect(report.issues[0].severity).toBe('breaking');
  });

  it('should detect modified paths as minor/modified', () => {
    const oldSchema: IRSchema = {
      info: { title: 'Test API', version: '1.0.0' },
      types: new Map(),
      endpoints: [
        {
          operationId: 'getUsers',
          method: 'GET',
          path: '/users',
          description: '',
          parameters: [],
          responses: []
        }
      ]
    };

    const newSchema: IRSchema = {
      info: { title: 'Test API', version: '1.0.0' },
      types: new Map(),
      endpoints: [
        {
          operationId: 'getUsers',
          method: 'GET',
          path: '/api/users', // Changed path
          description: '',
          parameters: [],
          responses: []
        }
      ]
    };

    const differ = new SchemaDiffer();
    const diff = differ.diff(oldSchema, newSchema);

    expect(diff.endpoints['getUsers'].type).toBe('modified');
    expect(diff.endpoints['getUsers'].changes![0].path).toBe('path');
    expect(diff.endpoints['getUsers'].changes![0].newValue).toBe('/api/users');

    const analyzer = new BreakingChangeAnalyzer();
    const report = analyzer.analyze(diff);

    expect(report.isBreaking).toBe(false); // Currently classified as minor
    expect(report.issues[0].severity).toBe('minor');
  });
});
