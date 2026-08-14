import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { validateOpenApiDocument } from '../src/openapi/validate';

/**
 * `openapi-valid.json` is real @axiomify/openapi generator output (see the
 * fixture header commit) — three routes with params/query/body/response
 * schemas, a deprecated route, and a bearerAuth securityScheme.
 */
const validSpec = () =>
  JSON.parse(
    readFileSync(
      path.join(__dirname, 'fixtures', 'openapi-valid.json'),
      'utf8',
    ),
  );

const codes = (findings: Array<{ code: string }>) =>
  findings.map((f) => f.code);

describe('openapi --validate: official OAS 3.1 schema', () => {
  it('passes a known-good generated spec with zero findings', async () => {
    const report = await validateOpenApiDocument(validSpec());
    expect(report.findings).toEqual([]);
    expect(report.valid).toBe(true);
  });

  it('passes a freshly generated spec (live @axiomify/openapi integration)', async () => {
    const { OpenApiGenerator } = await import('@axiomify/openapi');
    const app: any = {
      registeredRoutes: [
        {
          method: 'GET',
          path: '/things/:thingId',
          schema: {
            params: z.object({ thingId: z.string() }),
            query: z.object({ verbose: z.boolean().optional() }),
            response: z.object({ id: z.string() }),
          },
        },
      ],
    };
    const spec = new OpenApiGenerator(app, {
      info: { title: 'Live', version: '0.0.1' },
    }).generate();
    const report = await validateOpenApiDocument(spec);
    expect(report.valid).toBe(true);
    expect(report.findings).toEqual([]);
  });

  it('flags structural schema violations with JSON-pointer locations', async () => {
    const spec = validSpec();
    spec.info = 42; // info must be an object
    const report = await validateOpenApiDocument(spec);
    expect(report.valid).toBe(false);
    const finding = report.findings.find((f) => f.code === 'oas-schema')!;
    expect(finding.severity).toBe('error');
    expect(finding.location).toBe('/info');
  });

  it('rejects non-3.1 documents explicitly instead of mis-validating', async () => {
    const spec = validSpec();
    spec.openapi = '3.0.3';
    const report = await validateOpenApiDocument(spec);
    expect(report.valid).toBe(false);
    expect(codes(report.findings)).toContain('oas-version-unsupported');
    // Semantic lints still run even when schema validation is skipped.
    const missing = await validateOpenApiDocument({ openapi: '2.0' });
    expect(codes(missing.findings)).toContain('oas-version-unsupported');
  });
});

describe('openapi --validate: semantic lints', () => {
  it('flags responses missing a description', async () => {
    const spec = validSpec();
    delete spec.paths['/users'].post.responses['200'].description;
    const report = await validateOpenApiDocument(spec);
    const finding = report.findings.find(
      (f) => f.code === 'response-missing-description',
    )!;
    expect(finding).toBeDefined();
    expect(finding.severity).toBe('error');
    expect(finding.location).toBe('/paths/~1users/post/responses/200');
    expect(report.valid).toBe(false);
  });

  it('flags duplicate parameter name+in pairs', async () => {
    const spec = validSpec();
    const params = spec.paths['/users/{id}'].get.parameters;
    params.push(JSON.parse(JSON.stringify(params[0])));
    const report = await validateOpenApiDocument(spec);
    const finding = report.findings.find(
      (f) => f.code === 'duplicate-parameter',
    )!;
    expect(finding).toBeDefined();
    expect(finding.severity).toBe('error');
    expect(finding.location).toBe('/paths/~1users~1{id}/get/parameters/1');
    expect(finding.message).toContain('"id"');
  });

  it('does not flag same-name parameters in different locations', async () => {
    const spec = validSpec();
    spec.paths['/users/{id}'].get.parameters.push({
      name: 'id',
      in: 'query',
      required: false,
      schema: { type: 'string' },
    });
    const report = await validateOpenApiDocument(spec);
    expect(codes(report.findings)).not.toContain('duplicate-parameter');
  });

  it('flags duplicate operationIds across the document', async () => {
    const spec = validSpec();
    spec.paths['/users'].post.operationId =
      spec.paths['/users/{id}'].get.operationId;
    const report = await validateOpenApiDocument(spec);
    const finding = report.findings.find(
      (f) => f.code === 'duplicate-operation-id',
    )!;
    expect(finding).toBeDefined();
    expect(finding.severity).toBe('error');
    expect(finding.message).toContain('getUsersById');
  });

  it('flags path template variables without a matching path parameter', async () => {
    const spec = validSpec();
    spec.paths['/gadgets/{gadgetId}'] = {
      get: {
        operationId: 'getGadget',
        responses: { '200': { description: 'ok' } },
      },
    };
    const report = await validateOpenApiDocument(spec);
    const finding = report.findings.find(
      (f) => f.code === 'path-param-missing',
    )!;
    expect(finding).toBeDefined();
    expect(finding.severity).toBe('error');
    expect(finding.message).toContain('{gadgetId}');
  });

  it('flags path parameters without a matching template variable', async () => {
    const spec = validSpec();
    spec.paths['/users'].post.parameters = [
      { name: 'ghost', in: 'path', required: true, schema: { type: 'string' } },
    ];
    const report = await validateOpenApiDocument(spec);
    const finding = report.findings.find(
      (f) => f.code === 'path-param-unused',
    )!;
    expect(finding).toBeDefined();
    expect(finding.severity).toBe('error');
    expect(finding.location).toBe('/paths/~1users/post/parameters/0');
  });

  it('honours path-item-level parameters for template matching', async () => {
    const spec = validSpec();
    // Move the {id} parameter from the operation up to the path item.
    const item = spec.paths['/users/{id}'];
    item.parameters = item.get.parameters;
    delete item.get.parameters;
    delete item.delete.parameters;
    const report = await validateOpenApiDocument(spec);
    expect(codes(report.findings)).not.toContain('path-param-missing');
  });

  it('flags security requirements referencing undeclared schemes', async () => {
    const spec = validSpec();
    spec.paths['/users'].post.security = [{ apiKey: [] }];
    spec.security = [{ alsoMissing: [] }];
    const report = await validateOpenApiDocument(spec);
    const orphans = report.findings.filter(
      (f) => f.code === 'orphaned-security-scheme',
    );
    expect(orphans).toHaveLength(2);
    expect(orphans.map((f) => f.location)).toContain('/security/0');
    expect(orphans.some((f) => f.message.includes('"apiKey"'))).toBe(true);
  });

  it('explains the securitySchemas typo and preserves generator warnings', async () => {
    const spec = validSpec();
    spec.components.securitySchemas = spec.components.securitySchemes;
    delete spec.components.securitySchemes;
    spec['x-axiomify-warnings'] = [
      {
        code: 'unrepresentable-zod-schema',
        message: 'A transform was widened for OpenAPI.',
        location: 'POST /users request body',
      },
    ];

    const report = await validateOpenApiDocument(spec);
    expect(codes(report.findings)).toContain('security-schemes-typo');
    expect(codes(report.findings)).toContain('generator-warning');
  });

  it('accepts security requirements that reference declared schemes', async () => {
    // The fixture's POST /users already uses [{ bearerAuth: [] }].
    const report = await validateOpenApiDocument(validSpec());
    expect(codes(report.findings)).not.toContain('orphaned-security-scheme');
  });

  it('warns (but stays valid) on an empty paths object', async () => {
    const report = await validateOpenApiDocument({
      openapi: '3.1.0',
      info: { title: 'Empty', version: '1.0.0' },
      paths: {},
    });
    const finding = report.findings.find((f) => f.code === 'empty-paths')!;
    expect(finding).toBeDefined();
    expect(finding.severity).toBe('warn');
    expect(report.valid).toBe(true);
  });

  it('orders findings deterministically: errors before warnings', async () => {
    const spec = validSpec();
    spec.paths = {};
    spec.security = [{ nope: [] }];
    const report = await validateOpenApiDocument(spec);
    const severities = report.findings.map((f) => f.severity);
    expect(severities).toEqual(
      [...severities].sort((a, b) => (a === b ? 0 : a === 'error' ? -1 : 1)),
    );
  });
});
