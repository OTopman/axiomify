import { describe, expect, it, vi } from 'vitest';
import {
  AXIOMIFY_SANDBOX_TYPES,
  configureMonacoSandbox,
  getSandboxCompletions,
} from '../src/utils/monaco-intellisense';

describe('Monaco Script Sandbox IntelliSense', () => {
  const mockMonaco = {
    languages: {
      CompletionItemKind: {
        Method: 0,
        Property: 1,
        Variable: 2,
        Snippet: 3,
      },
      CompletionItemInsertTextRule: {
        InsertAsSnippet: 4,
      },
      typescript: {
        ScriptTarget: { ES2020: 7 },
        javascriptDefaults: {
          setDiagnosticsOptions: vi.fn(),
          setCompilerOptions: vi.fn(),
          addExtraLib: vi.fn(),
        },
        typescriptDefaults: {
          setDiagnosticsOptions: vi.fn(),
          setCompilerOptions: vi.fn(),
          addExtraLib: vi.fn(),
        },
      },
      registerCompletionItemProvider: vi.fn(),
      registerHoverProvider: vi.fn(),
      registerSignatureHelpProvider: vi.fn(),
    },
  };

  it('defines typing contracts for $, axiomify, and pm globals', () => {
    expect(AXIOMIFY_SANDBOX_TYPES).toContain(
      'declare const axiomify: AxiomifyContext;',
    );
    expect(AXIOMIFY_SANDBOX_TYPES).toContain(
      'declare const $: AxiomifyContext;',
    );
    expect(AXIOMIFY_SANDBOX_TYPES).toContain('declare const pm:');
    expect(AXIOMIFY_SANDBOX_TYPES).toContain('interface Expectation');
    expect(AXIOMIFY_SANDBOX_TYPES).toContain('interface ScriptEnvironment');
    expect(AXIOMIFY_SANDBOX_TYPES).toContain('interface ScriptRequest');
    expect(AXIOMIFY_SANDBOX_TYPES).toContain('interface ScriptResponse');
  });

  it('provides rich completions when typing axiomify. or $.', () => {
    const model = {
      getLineContent: () => 'axiomify.',
      getWordUntilPosition: () => ({
        word: '',
        startColumn: 10,
        endColumn: 10,
      }),
    };
    const result = getSandboxCompletions(
      model,
      { lineNumber: 1, column: 10 },
      mockMonaco,
    );
    const labels = result.suggestions.map((s) => s.label);
    expect(labels).toContain('test');
    expect(labels).toContain('expect');
    expect(labels).toContain('request');
    expect(labels).toContain('response');
    expect(labels).toContain('env');
    expect(labels).toContain('log');
  });

  it('provides request completions when typing $.request.', () => {
    const model = {
      getLineContent: () => '$.request.',
      getWordUntilPosition: () => ({
        word: '',
        startColumn: 11,
        endColumn: 11,
      }),
    };
    const result = getSandboxCompletions(
      model,
      { lineNumber: 1, column: 11 },
      mockMonaco,
    );
    const labels = result.suggestions.map((s) => s.label);
    expect(labels).toContain('headers');
    expect(labels).toContain('params');
    expect(labels).toContain('body');
    expect(labels).toContain('method');
    expect(labels).toContain('url');
  });

  it('provides response completions when typing $.response.', () => {
    const model = {
      getLineContent: () => '$.response.',
      getWordUntilPosition: () => ({
        word: '',
        startColumn: 12,
        endColumn: 12,
      }),
    };
    const result = getSandboxCompletions(
      model,
      { lineNumber: 1, column: 12 },
      mockMonaco,
    );
    const labels = result.suggestions.map((s) => s.label);
    expect(labels).toContain('status');
    expect(labels).toContain('json');
    expect(labels).toContain('text');
    expect(labels).toContain('headers');
    expect(labels).toContain('responseTime');
  });

  it('provides env completions when typing $.env.', () => {
    const model = {
      getLineContent: () => '$.env.',
      getWordUntilPosition: () => ({ word: '', startColumn: 7, endColumn: 7 }),
    };
    const result = getSandboxCompletions(
      model,
      { lineNumber: 1, column: 7 },
      mockMonaco,
    );
    const labels = result.suggestions.map((s) => s.label);
    expect(labels).toContain('get');
    expect(labels).toContain('set');
    expect(labels).toContain('unset');
    expect(labels).toContain('toObject');
  });

  it('provides matcher completions when typing expect(x).', () => {
    const model = {
      getLineContent: () => '$.expect($.response.status).',
      getWordUntilPosition: () => ({
        word: '',
        startColumn: 29,
        endColumn: 29,
      }),
    };
    const result = getSandboxCompletions(
      model,
      { lineNumber: 1, column: 29 },
      mockMonaco,
    );
    const labels = result.suggestions.map((s) => s.label);
    expect(labels).toContain('toBe');
    expect(labels).toContain('toEqual');
    expect(labels).toContain('toHaveProperty');
    expect(labels).toContain('toBeGreaterThan');
    expect(labels).toContain('toContain');
    expect(labels).toContain('not');
  });

  it('configures Monaco providers for both javascript and typescript', () => {
    configureMonacoSandbox(mockMonaco);
    expect(
      mockMonaco.languages.registerCompletionItemProvider,
    ).toHaveBeenCalledWith('javascript', expect.any(Object));
    expect(
      mockMonaco.languages.registerCompletionItemProvider,
    ).toHaveBeenCalledWith('typescript', expect.any(Object));
  });
});
