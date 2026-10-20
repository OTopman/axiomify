/**
 * Monaco Editor TypeScript definitions & custom completion providers for Axiomify Script Sandbox
 *
 * Provides immediate, reliable autocomplete for:
 * - `axiomify.*` and `$.*` (test, expect, request, response, env, log)
 * - `axiomify.request.*` and `$.request.*` (headers, params, body, method, url)
 * - `axiomify.response.*` and `$.response.*` (status, statusText, headers, json(), text(), responseTime, data)
 * - `axiomify.env.*` and `$.env.*` (get, set, unset, toObject)
 * - `expect(...).*` (toBe, toEqual, toBeDefined, toContain, toHaveProperty, etc.)
 * - `pm.*` (Postman compatibility namespace)
 */

export const AXIOMIFY_SANDBOX_TYPES = `
interface ScriptRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: any;
  params: Record<string, string>;
}

interface ScriptResponse {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  responseTime: number;
  data?: any;
  json: () => any;
  text: () => string;
}

interface Expectation {
  toBe(expected: any): void;
  toEqual(expected: any): void;
  toBeDefined(): void;
  toBeUndefined(): void;
  toBeNull(): void;
  toBeTruthy(): void;
  toBeFalsy(): void;
  toBeGreaterThan(n: number): void;
  toBeGreaterThanOrEqual(n: number): void;
  toBeLessThan(n: number): void;
  toBeLessThanOrEqual(n: number): void;
  toContain(item: any): void;
  toBeOneOf(array: any[]): void;
  toHaveProperty(prop: string, value?: any): void;
  toThrow(): void;
  toMatch(regex: RegExp | string): void;
  not: Omit<Expectation, 'not'>;
}

interface ScriptEnvironment {
  get(key: string): string | undefined;
  set(key: string, value: any): void;
  unset(key: string): void;
  toObject(): Record<string, string>;
}

interface AxiomifyContext {
  request: ScriptRequest;
  response?: ScriptResponse;
  env: ScriptEnvironment;
  test(name: string, fn: () => void | Promise<void>): void;
  expect(actual: any): Expectation;
  log(...args: any[]): void;
}

declare const axiomify: AxiomifyContext;
declare const $: AxiomifyContext;
declare const pm: {
  test: AxiomifyContext['test'];
  expect: AxiomifyContext['expect'];
  response?: {
    code: number;
    status: string;
    responseTime: number;
    headers: Record<string, string>;
    json: () => any;
    text: () => string;
    to: { have: { status: (code: number) => void } };
  };
  environment: ScriptEnvironment;
  variables: ScriptEnvironment;
};
`;

let monacoConfigured = false;

export function getSandboxCompletions(model: any, position: any, monaco: any) {
  const lineContent = model.getLineContent(position.lineNumber);
  const textUntilPosition = lineContent.slice(0, position.column - 1);
  const word = model.getWordUntilPosition(position);
  const range = {
    startLineNumber: position.lineNumber,
    endLineNumber: position.lineNumber,
    startColumn: word.startColumn,
    endColumn: word.endColumn,
  };

  const suggestions: any[] = [];
  const K = monaco.languages.CompletionItemKind;
  const R = monaco.languages.CompletionItemInsertTextRule;

  // 1. $.request. / axiomify.request.
  if (/(?:axiomify|\$)\.request\.([a-zA-Z0-9_$]*)$/.test(textUntilPosition)) {
    suggestions.push(
      {
        label: 'headers',
        kind: K.Property,
        detail: 'Record<string, string>',
        documentation: { value: 'Outgoing HTTP request headers map. Mutate headers before sending.' },
        insertText: "headers['${1:Header-Name}'] = '${2:value}';",
        insertTextRules: R.InsertAsSnippet,
        range,
      },
      {
        label: 'params',
        kind: K.Property,
        detail: 'Record<string, string>',
        documentation: { value: 'Query parameters dictionary.' },
        insertText: "params['${1:paramName}'] = '${2:value}';",
        insertTextRules: R.InsertAsSnippet,
        range,
      },
      {
        label: 'body',
        kind: K.Property,
        detail: 'any',
        documentation: { value: 'Request body payload (JSON object or string).' },
        insertText: 'body',
        range,
      },
      {
        label: 'method',
        kind: K.Property,
        detail: 'string',
        documentation: { value: 'HTTP method (GET, POST, PUT, DELETE, etc.).' },
        insertText: 'method',
        range,
      },
      {
        label: 'url',
        kind: K.Property,
        detail: 'string',
        documentation: { value: 'Request URL or path.' },
        insertText: 'url',
        range,
      },
    );
    return { suggestions };
  }

  // 2. $.response. / axiomify.response.
  if (/(?:axiomify|\$)\.response\.([a-zA-Z0-9_$]*)$/.test(textUntilPosition)) {
    suggestions.push(
      {
        label: 'status',
        kind: K.Property,
        detail: 'number',
        documentation: { value: 'HTTP response status code (e.g. 200, 404, 500).' },
        insertText: 'status',
        range,
      },
      {
        label: 'statusText',
        kind: K.Property,
        detail: 'string',
        documentation: { value: 'HTTP status text (e.g. "OK", "Not Found").' },
        insertText: 'statusText',
        range,
      },
      {
        label: 'headers',
        kind: K.Property,
        detail: 'Record<string, string>',
        documentation: { value: 'Response headers returned by the server.' },
        insertText: 'headers',
        range,
      },
      {
        label: 'json',
        kind: K.Method,
        detail: '(): any',
        documentation: { value: 'Parses and returns the response body as a JSON object.' },
        insertText: 'json()',
        range,
      },
      {
        label: 'text',
        kind: K.Method,
        detail: '(): string',
        documentation: { value: 'Returns the raw response body as a string.' },
        insertText: 'text()',
        range,
      },
      {
        label: 'responseTime',
        kind: K.Property,
        detail: 'number',
        documentation: { value: 'Response duration / latency in milliseconds.' },
        insertText: 'responseTime',
        range,
      },
      {
        label: 'data',
        kind: K.Property,
        detail: 'any',
        documentation: { value: 'Directly parsed response data object (if JSON).' },
        insertText: 'data',
        range,
      },
    );
    return { suggestions };
  }

  // 3. $.env. / axiomify.env.
  if (/(?:axiomify|\$)\.env\.([a-zA-Z0-9_$]*)$/.test(textUntilPosition)) {
    suggestions.push(
      {
        label: 'get',
        kind: K.Method,
        detail: '(key: string): string | undefined',
        documentation: { value: 'Retrieve an environment variable value by name.' },
        insertText: "get('${1:variableName}')",
        insertTextRules: R.InsertAsSnippet,
        range,
      },
      {
        label: 'set',
        kind: K.Method,
        detail: '(key: string, value: any): void',
        documentation: { value: 'Persist or update an environment variable during execution.' },
        insertText: "set('${1:variableName}', ${2:value});",
        insertTextRules: R.InsertAsSnippet,
        range,
      },
      {
        label: 'unset',
        kind: K.Method,
        detail: '(key: string): void',
        documentation: { value: 'Remove an environment variable from active state.' },
        insertText: "unset('${1:variableName}')",
        insertTextRules: R.InsertAsSnippet,
        range,
      },
      {
        label: 'toObject',
        kind: K.Method,
        detail: '(): Record<string, string>',
        documentation: { value: 'Return all active environment variables as a key-value dictionary.' },
        insertText: 'toObject()',
        range,
      },
    );
    return { suggestions };
  }

  // 4. Expectation matchers: expect(...). or expect(...).not.
  if (/(?:expect\(.*?\)|(?:\$|axiomify)\.expect\(.*?\))(?:\.not)?\.([a-zA-Z0-9_$]*)$/.test(textUntilPosition)) {
    suggestions.push(
      {
        label: 'toBe',
        kind: K.Method,
        detail: '(expected: any): void',
        documentation: { value: 'Strict equality matcher (`===`).' },
        insertText: 'toBe(${1:expected})',
        insertTextRules: R.InsertAsSnippet,
        range,
      },
      {
        label: 'toEqual',
        kind: K.Method,
        detail: '(expected: any): void',
        documentation: { value: 'Deep structural equality comparison for objects and arrays.' },
        insertText: 'toEqual(${1:expected})',
        insertTextRules: R.InsertAsSnippet,
        range,
      },
      {
        label: 'toHaveProperty',
        kind: K.Method,
        detail: '(prop: string, value?: any): void',
        documentation: { value: 'Asserts that the object has the specified property path, optionally matching value.' },
        insertText: "toHaveProperty('${1:propName}')",
        insertTextRules: R.InsertAsSnippet,
        range,
      },
      {
        label: 'toBeDefined',
        kind: K.Method,
        detail: '(): void',
        documentation: { value: 'Asserts that value !== undefined.' },
        insertText: 'toBeDefined()',
        range,
      },
      {
        label: 'toBeUndefined',
        kind: K.Method,
        detail: '(): void',
        documentation: { value: 'Asserts that value === undefined.' },
        insertText: 'toBeUndefined()',
        range,
      },
      {
        label: 'toBeNull',
        kind: K.Method,
        detail: '(): void',
        documentation: { value: 'Asserts that value === null.' },
        insertText: 'toBeNull()',
        range,
      },
      {
        label: 'toBeTruthy',
        kind: K.Method,
        detail: '(): void',
        documentation: { value: 'Asserts that value is truthy (Boolean(val) === true).' },
        insertText: 'toBeTruthy()',
        range,
      },
      {
        label: 'toBeFalsy',
        kind: K.Method,
        detail: '(): void',
        documentation: { value: 'Asserts that value is falsy (Boolean(val) === false).' },
        insertText: 'toBeFalsy()',
        range,
      },
      {
        label: 'toBeGreaterThan',
        kind: K.Method,
        detail: '(n: number): void',
        documentation: { value: 'Asserts number > n.' },
        insertText: 'toBeGreaterThan(${1:0})',
        insertTextRules: R.InsertAsSnippet,
        range,
      },
      {
        label: 'toBeGreaterThanOrEqual',
        kind: K.Method,
        detail: '(n: number): void',
        documentation: { value: 'Asserts number >= n.' },
        insertText: 'toBeGreaterThanOrEqual(${1:0})',
        insertTextRules: R.InsertAsSnippet,
        range,
      },
      {
        label: 'toBeLessThan',
        kind: K.Method,
        detail: '(n: number): void',
        documentation: { value: 'Asserts number < n.' },
        insertText: 'toBeLessThan(${1:1000})',
        insertTextRules: R.InsertAsSnippet,
        range,
      },
      {
        label: 'toBeLessThanOrEqual',
        kind: K.Method,
        detail: '(n: number): void',
        documentation: { value: 'Asserts number <= n.' },
        insertText: 'toBeLessThanOrEqual(${1:1000})',
        insertTextRules: R.InsertAsSnippet,
        range,
      },
      {
        label: 'toContain',
        kind: K.Method,
        detail: '(item: any): void',
        documentation: { value: 'Asserts array includes item, or string contains substring.' },
        insertText: 'toContain(${1:item})',
        insertTextRules: R.InsertAsSnippet,
        range,
      },
      {
        label: 'toBeOneOf',
        kind: K.Method,
        detail: '(array: any[]): void',
        documentation: { value: 'Asserts value is contained within the supplied list.' },
        insertText: 'toBeOneOf([${1:item1}, ${2:item2}])',
        insertTextRules: R.InsertAsSnippet,
        range,
      },
      {
        label: 'toMatch',
        kind: K.Method,
        detail: '(regex: RegExp | string): void',
        documentation: { value: 'Asserts string matches regular expression.' },
        insertText: 'toMatch(${1:/pattern/})',
        insertTextRules: R.InsertAsSnippet,
        range,
      },
      {
        label: 'toThrow',
        kind: K.Method,
        detail: '(): void',
        documentation: { value: 'Asserts that the function throws an error.' },
        insertText: 'toThrow()',
        range,
      },
      {
        label: 'not',
        kind: K.Property,
        detail: 'Expectation',
        documentation: { value: 'Inverts the assertion expectation matcher.' },
        insertText: 'not.',
        range,
      },
    );
    return { suggestions };
  }

  // 5. axiomify. or $.
  if (/(?:axiomify|\$)\.([a-zA-Z0-9_$]*)$/.test(textUntilPosition)) {
    suggestions.push(
      {
        label: 'test',
        kind: K.Method,
        detail: '(name: string, fn: () => void | Promise<void>): void',
        documentation: { value: 'Declare an automated test assertion block to validate the response.' },
        insertText: "test('${1:Status is 200}', () => {\n\t$.expect($.response.status).toBe(200);\n});",
        insertTextRules: R.InsertAsSnippet,
        range,
      },
      {
        label: 'expect',
        kind: K.Method,
        detail: '(actual: any): Expectation',
        documentation: { value: 'Create an assertion matcher on any value or response property.' },
        insertText: 'expect(${1:actual}).$0',
        insertTextRules: R.InsertAsSnippet,
        range,
      },
      {
        label: 'request',
        kind: K.Property,
        detail: 'ScriptRequest',
        documentation: { value: 'Access or mutate outgoing request headers, query params, body, or URL.' },
        insertText: 'request',
        range,
      },
      {
        label: 'response',
        kind: K.Property,
        detail: 'ScriptResponse',
        documentation: { value: 'Access received HTTP response status, headers, json(), text(), or responseTime.' },
        insertText: 'response',
        range,
      },
      {
        label: 'env',
        kind: K.Property,
        detail: 'ScriptEnvironment',
        documentation: { value: 'Manage environment variables across scripts (get, set, unset, toObject).' },
        insertText: 'env',
        range,
      },
      {
        label: 'log',
        kind: K.Method,
        detail: '(...args: any[]): void',
        documentation: { value: 'Print debug output to the test execution logs.' },
        insertText: "log('${1:message}');",
        insertTextRules: R.InsertAsSnippet,
        range,
      },
    );
    return { suggestions };
  }

  // 6. pm.response.to.have.
  if (/pm\.response\.to\.have\.([a-zA-Z0-9_$]*)$/.test(textUntilPosition)) {
    suggestions.push({
      label: 'status',
      kind: K.Method,
      detail: '(code: number): void',
      documentation: { value: 'Assert response status code (Postman style).' },
      insertText: 'status(${1:200})',
      insertTextRules: R.InsertAsSnippet,
      range,
    });
    return { suggestions };
  }

  // 7. pm.response.to.
  if (/pm\.response\.to\.([a-zA-Z0-9_$]*)$/.test(textUntilPosition)) {
    suggestions.push({
      label: 'have',
      kind: K.Property,
      detail: '{ status: (code: number) => void }',
      documentation: { value: 'Postman expectation chaining helper.' },
      insertText: 'have.',
      range,
    });
    return { suggestions };
  }

  // 8. pm.response.
  if (/pm\.response\.([a-zA-Z0-9_$]*)$/.test(textUntilPosition)) {
    suggestions.push(
      { label: 'code', kind: K.Property, detail: 'number', insertText: 'code', range },
      { label: 'status', kind: K.Property, detail: 'string', insertText: 'status', range },
      { label: 'responseTime', kind: K.Property, detail: 'number', insertText: 'responseTime', range },
      { label: 'headers', kind: K.Property, detail: 'Record<string, string>', insertText: 'headers', range },
      { label: 'json', kind: K.Method, detail: '(): any', insertText: 'json()', range },
      { label: 'text', kind: K.Method, detail: '(): string', insertText: 'text()', range },
      { label: 'to', kind: K.Property, detail: 'Chaining assertion helper', insertText: 'to.', range },
    );
    return { suggestions };
  }

  // 9. pm.
  if (/pm\.([a-zA-Z0-9_$]*)$/.test(textUntilPosition)) {
    suggestions.push(
      {
        label: 'test',
        kind: K.Method,
        detail: '(name: string, fn: () => void): void',
        insertText: "test('${1:test name}', () => {\n\t$0\n});",
        insertTextRules: R.InsertAsSnippet,
        range,
      },
      {
        label: 'expect',
        kind: K.Method,
        detail: '(actual: any): Expectation',
        insertText: 'expect(${1:actual}).$0',
        insertTextRules: R.InsertAsSnippet,
        range,
      },
      { label: 'response', kind: K.Property, detail: 'Postman response shim', insertText: 'response', range },
      { label: 'environment', kind: K.Property, detail: 'ScriptEnvironment', insertText: 'environment', range },
      { label: 'variables', kind: K.Property, detail: 'ScriptEnvironment', insertText: 'variables', range },
    );
    return { suggestions };
  }

  // 10. General root level suggestions
  suggestions.push(
    {
      label: 'axiomify',
      kind: K.Variable,
      detail: 'AxiomifyContext',
      documentation: { value: 'Canonical Axiomify test and pre-request execution sandbox.' },
      insertText: 'axiomify',
      range,
    },
    {
      label: '$',
      kind: K.Variable,
      detail: 'AxiomifyContext',
      documentation: { value: 'Ergonomic shorthand for axiomify context ($ = axiomify).' },
      insertText: '$',
      range,
    },
    {
      label: 'pm',
      kind: K.Variable,
      detail: 'Postman compatibility context',
      documentation: { value: 'Postman compatible runtime context for existing scripts.' },
      insertText: 'pm',
      range,
    },
    {
      label: 'test (snippet)',
      kind: K.Snippet,
      detail: '$.test(name, fn)',
      documentation: { value: 'Insert a complete test assertion block.' },
      insertText: "$.test('${1:Status code is 200}', () => {\n\t$.expect($.response.status).toBe(${2:200});\n});",
      insertTextRules: R.InsertAsSnippet,
      range,
    },
    {
      label: 'expect (snippet)',
      kind: K.Snippet,
      detail: '$.expect(...)',
      documentation: { value: 'Insert an expectation matcher statement.' },
      insertText: '$.expect(${1:$.response.status}).toBe(${2:200});',
      insertTextRules: R.InsertAsSnippet,
      range,
    },
    {
      label: 'header mutation (snippet)',
      kind: K.Snippet,
      detail: "$.request.headers['...']",
      documentation: { value: 'Add or modify an outgoing HTTP header in pre-request.' },
      insertText: "$.request.headers['${1:X-Custom-Header}'] = ${2:'value'};",
      insertTextRules: R.InsertAsSnippet,
      range,
    },
    {
      label: 'set environment (snippet)',
      kind: K.Snippet,
      detail: "$.env.set('key', value)",
      documentation: { value: 'Set or update an environment variable.' },
      insertText: "$.env.set('${1:variableName}', ${2:value});",
      insertTextRules: R.InsertAsSnippet,
      range,
    },
    {
      label: 'json response (snippet)',
      kind: K.Snippet,
      detail: 'const data = $.response.json();',
      documentation: { value: 'Parse and store JSON response body.' },
      insertText: 'const res = $.response.json();',
      range,
    },
  );

  return { suggestions };
}

export function configureMonacoSandbox(monaco: any) {
  if (!monaco || monacoConfigured) return;
  monacoConfigured = true;

  try {
    const languages = ['javascript', 'typescript'];

    // 1. Configure TypeScript / JavaScript compiler options & extra libraries
    const ts = monaco.languages.typescript;
    if (ts) {
      const configureDefaults = (defaults: any) => {
        if (!defaults) return;
        defaults.setDiagnosticsOptions({
          noSemanticValidation: false,
          noSyntaxValidation: false,
        });
        defaults.setCompilerOptions({
          target: ts.ScriptTarget.ES2020,
          allowNonTsExtensions: true,
          checkJs: true,
        });
        defaults.addExtraLib(
          AXIOMIFY_SANDBOX_TYPES,
          'file:///node_modules/@types/axiomify/index.d.ts',
        );
      };

      configureDefaults(ts.javascriptDefaults);
      configureDefaults(ts.typescriptDefaults);
    }

    // 2. Register synchronous, 100% reliable CompletionItemProvider for both javascript & typescript
    languages.forEach((lang) => {
      monaco.languages.registerCompletionItemProvider(lang, {
        triggerCharacters: ['.', '(', '"', "'", '$', 'a', 'p'],
        provideCompletionItems: (model: any, position: any) =>
          getSandboxCompletions(model, position, monaco),
      });

      // 3. Register HoverProvider for rich tooltips
      monaco.languages.registerHoverProvider(lang, {
        provideHover: (model: any, position: any) => {
          const word = model.getWordAtPosition(position)?.word;
          if (!word) return null;

          if (word === 'axiomify' || word === '$') {
            return {
              contents: [
                { value: '**Axiomify Script Sandbox Context**' },
                { value: 'Provides `$.test()`, `$.expect()`, `$.request`, `$.response`, `$.env`, and `$.log()`.' },
              ],
            };
          }
          if (word === 'pm') {
            return {
              contents: [
                { value: '**Postman Compatibility Shim**' },
                { value: 'Provides `pm.test()`, `pm.expect()`, and `pm.response` for existing Postman test scripts.' },
              ],
            };
          }
          if (word === 'test') {
            return {
              contents: [
                { value: '`$.test(name: string, fn: () => void | Promise<void>): void`' },
                { value: 'Defines an automated assertion test block. The test passes if no expectation throws an error.' },
              ],
            };
          }
          if (word === 'expect') {
            return {
              contents: [
                { value: '`$.expect(actual: any): Expectation`' },
                { value: 'Wraps a value in an expectation matcher (`toBe`, `toEqual`, `toHaveProperty`, `toContain`, etc.).' },
              ],
            };
          }
          if (word === 'request') {
            return {
              contents: [
                { value: '`$.request: ScriptRequest`' },
                { value: 'Access and mutate outgoing request headers, query parameters, method, url, and body.' },
              ],
            };
          }
          if (word === 'response') {
            return {
              contents: [
                { value: '`$.response: ScriptResponse`' },
                { value: 'Access incoming response status, statusText, headers, json(), text(), and responseTime.' },
              ],
            };
          }
          if (word === 'env') {
            return {
              contents: [
                { value: '`$.env: ScriptEnvironment`' },
                { value: 'Manage active environment variables with `.get()`, `.set()`, `.unset()`, and `.toObject()`.' },
              ],
            };
          }
          if (word === 'log') {
            return {
              contents: [
                { value: '`$.log(...args: any[]): void`' },
                { value: 'Prints messages to the test / pre-request script logs console.' },
              ],
            };
          }
          return null;
        },
      });

      // 4. Register SignatureHelpProvider
      monaco.languages.registerSignatureHelpProvider(lang, {
        signatureHelpTriggerCharacters: ['(', ','],
        provideSignatureHelp: (model: any, position: any) => {
          const linePrefix = model.getLineContent(position.lineNumber).slice(0, position.column - 1);
          if (/(?:axiomify|\$)\.test\([^)]*$/.test(linePrefix)) {
            return {
              value: {
                activeParameter: 0,
                activeSignature: 0,
                signatures: [
                  {
                    label: 'test(name: string, fn: () => void | Promise<void>): void',
                    documentation: 'Declare a test assertion block to validate the response.',
                    parameters: [
                      { label: 'name', documentation: 'Human readable name of the test' },
                      { label: 'fn', documentation: 'Assertion callback containing $.expect() statements' },
                    ],
                  },
                ],
              },
              dispose: () => { },
            };
          }
          if (/(?:axiomify|\$)\.expect\([^)]*$/.test(linePrefix)) {
            return {
              value: {
                activeParameter: 0,
                activeSignature: 0,
                signatures: [
                  {
                    label: 'expect(actual: any): Expectation',
                    documentation: 'Wrap a value to perform assertions.',
                    parameters: [
                      { label: 'actual', documentation: 'The actual value to evaluate' },
                    ],
                  },
                ],
              },
              dispose: () => { },
            };
          }
          return null;
        },
      });
    });
  } catch (err) {
    console.warn('Failed to configure Monaco sandbox IntelliSense:', err);
  }
}
