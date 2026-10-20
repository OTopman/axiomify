import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { generateSdk } from '../../src/commands/sdk/generate';
import { TypeScriptGenerator } from '../../src/sdk/generator/targets/typescript';
import type { IRSchema } from '../../src/sdk/ir/types';
import { Axiomify } from '@axiomify/core';
import { createTestClient } from '@axiomify/testing';
import { BaseClient } from '@axiomify/sdk-runtime';
import ts from 'typescript';

describe('SDK Generation CLI Command', () => {
  let consoleErrorSpy: any;
  let processExitSpy: any;

  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    processExitSpy = vi
      .spyOn(process, 'exit')
      .mockImplementation((code?: string | number | null | undefined) => {
        throw new Error(`process.exit called with ${code}`);
      });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should reject output directory outside project root when exitOnError is false', async () => {
    const success = await generateSdk({
      input: 'valid.json',
      target: ['typescript'],
      output: '../outside-directory',
      exitOnError: false,
    });

    expect(success).toBe(false);
    expect(consoleErrorSpy).toHaveBeenCalled();
    expect(consoleErrorSpy.mock.calls[0][0]).toContain(
      'must be contained within the project root directory',
    );
    expect(processExitSpy).not.toHaveBeenCalled();
  });

  it('should call process.exit(1) on output directory outside project root by default', async () => {
    await expect(
      generateSdk({
        input: 'valid.json',
        target: ['typescript'],
        output: '/absolute/path/outside',
      }),
    ).rejects.toThrow('process.exit called with 1');

    expect(consoleErrorSpy).toHaveBeenCalled();
    expect(consoleErrorSpy.mock.calls[0][0]).toContain(
      'must be contained within the project root directory',
    );
  });

  it('should permit output directory inside project root', async () => {
    // We expect it to try reading the input file (ingestion step) and fail because the file doesn't exist.
    // This confirms it passed the containment check and proceeded to the ingestion step.
    const success = await generateSdk({
      input: 'nonexistent-input-file.json',
      target: ['typescript'],
      output: './inside-directory',
      exitOnError: false,
    });

    expect(success).toBe(false);
    // It should have logged "Ingestion failed" because the input file doesn't exist.
    expect(consoleErrorSpy).toHaveBeenCalled();
    expect(consoleErrorSpy.mock.calls[0][0]).toContain('Ingestion failed');
    expect(consoleErrorSpy.mock.calls[0][0]).not.toContain(
      'must be contained within the project root directory',
    );
  });
});

describe('generated TypeScript SDK contract', () => {
  it('drives requests through the API and validates the returned contract', async () => {
    const schema: IRSchema = {
      info: { title: 'Tasks API', version: '1.0.0' },
      types: new Map(),
      securitySchemes: new Map(),
      servers: [],
      globalSecurity: [],
      events: [],
      reactiveContracts: [],
      endpoints: [
        {
          operationId: 'createTask',
          method: 'POST',
          path: '/api/v1/tasks',
          description: '',
          tags: [],
          transport: 'rest',
          parameters: [],
          pathParams: [],
          queryParams: [],
          headerParams: [],
          requestBody: {
            required: true,
            contentType: 'application/json',
            type: {
              inline: { kind: 'scalar', id: 'CreateBody', scalar: 'any' },
            },
          },
          responses: {
            201: {
              statusCode: '201',
              description: 'Created',
              type: { inline: { kind: 'scalar', id: 'Task', scalar: 'any' } },
            },
          },
          successResponse: '201',
          security: [],
        },
      ],
    };

    const files = await new TypeScriptGenerator(schema, {
      packageName: 'tasks-sdk',
      outputDir: '/tmp/tasks-sdk',
    }).generate();
    const generatedClient = files.find((file) => file.path === 'client.ts');
    expect(generatedClient?.content).toContain('async createTask(');
    expect(generatedClient?.content).toContain("method: 'POST'");
    expect(generatedClient?.content).toContain('path: `/api/v1/tasks`');
    expect(generatedClient?.content).toContain('body: request.body');

    const app = new Axiomify();
    app.route({
      method: 'POST',
      path: '/api/v1/tasks',
      handler: (req, res) => {
        const body = req.body as { title: string };
        res.status(201).send({ id: 'task-1', title: body.title });
      },
    });
    const testClient = createTestClient(app);
    const fetch = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(String(input));
        const response = await testClient.inject({
          method: init?.method as 'POST',
          url: `${url.pathname}${url.search}`,
          headers: Object.fromEntries(new Headers(init?.headers).entries()),
          body: init?.body ? JSON.parse(String(init.body)) : undefined,
        });
        let envelope: unknown = response.body;
        if (typeof envelope === 'string') {
          try {
            envelope = JSON.parse(envelope);
          } catch {
            // Preserve non-JSON test responses as-is.
          }
        }
        const payload =
          envelope && typeof envelope === 'object' && 'data' in envelope
            ? (envelope as { data: unknown }).data
            : envelope;
        return new Response(JSON.stringify(payload), {
          status: response.statusCode,
          headers: { 'content-type': 'application/json' },
        });
      },
    );

    const moduleSource = generatedClient!.content
      .replace(
        "import { BaseClient, WebSocketClient, type ClientConfig, type WebSocketClientOptions } from '@axiomify/sdk-runtime';",
        '',
      )
      .replace("import type * as Types from './types';", '');
    const javascript = ts.transpile(moduleSource, {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
    });
    const generatedModule = { exports: {} as Record<string, unknown> };
    new Function('BaseClient', 'module', 'exports', javascript)(
      BaseClient,
      generatedModule,
      generatedModule.exports,
    );
    const GeneratedClient = generatedModule.exports.ApiClient as new (config: {
      baseUrl: string;
      fetch: typeof fetch;
    }) => {
      createTask(request: { body: { title: string } }): Promise<unknown>;
    };
    const sdk = new GeneratedClient({ baseUrl: 'http://axiomify.test', fetch });
    await expect(
      sdk.createTask({ body: { title: 'SDK contract' } }),
    ).resolves.toEqual({
      id: 'task-1',
      title: 'SDK contract',
    });
    expect(fetch).toHaveBeenCalledOnce();
  });
});
