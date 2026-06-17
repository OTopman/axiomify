import { describe, it, expect, vi } from 'vitest';
import {
  redactPII,
  redactHeaders,
  buildContext,
} from '../../src/studio/api/ai';
import type { StudioDiscoveryResult } from '../../src/studio/discovery/types';

describe('Studio AI Assistant', () => {
  describe('PII Redaction', () => {
    it('should redact sensitive keys recursively', () => {
      const data = {
        username: 'alice',
        password: 'supersecretpassword123',
        nested: {
          token: 'jwt-token-value',
          apiKey: 'key-12345',
          safeField: 'hello',
        },
        emailsList: ['user@example.com'],
      };

      const redacted = redactPII(data);
      expect(redacted.username).toBe('alice');
      expect(redacted.password).toBe('[REDACTED]');
      expect(redacted.nested.token).toBe('[REDACTED]');
      expect(redacted.nested.apiKey).toBe('[REDACTED]');
      expect(redacted.nested.safeField).toBe('hello');
    });

    it('should redact tokens and emails in string values', () => {
      // Email string
      expect(redactPII('test@example.com')).toBe('[REDACTED_EMAIL]');

      // Token string (long, no spaces)
      const longToken = 'a'.repeat(60);
      expect(redactPII(longToken)).toBe('[REDACTED_TOKEN]');

      // Normal text should not be redacted
      expect(
        redactPII('This is a normal description text with some length.'),
      ).toBe('This is a normal description text with some length.');
    });

    it('should redact sensitive headers', () => {
      const headers = {
        'content-type': 'application/json',
        authorization: 'Bearer secret_token_xyz',
        'x-api-key': 'secret_key_123',
      };

      const redacted = redactHeaders(headers);
      expect(redacted['content-type']).toBe('application/json');
      expect(redacted.authorization).toBe('[REDACTED]');
      expect(redacted['x-api-key']).toBe('[REDACTED]');
    });
  });

  describe('Context Builder', () => {
    it('should correctly format context bundle for the AI model', () => {
      const discovery: StudioDiscoveryResult = {
        routes: [
          {
            method: 'GET',
            path: '/api/users',
            isWs: false,
            validation: [{ type: 'body', schema: {} }],
            tags: [],
            deprecated: false,
            pluginCount: 0,
            hasResponseSchema: true,
          },
        ],
        schemas: [],
        hooks: [],
        config: {
          timeout: 0,
          routeConflict: 'throw',
          strictSchema: false,
          httpRouteCount: 1,
          wsRouteCount: 0,
          hookCount: 0,
          serviceCount: 0,
        },
        openapi: null,
        health: {
          findings: [],
          summary: { passes: 1, warnings: 0, failures: 0 },
        },
        discoveredAt: new Date().toISOString(),
      };

      const session = {
        entries: [
          {
            requestId: 'req-1',
            request: {
              method: 'GET',
              path: '/api/users',
              headers: { authorization: 'secret' },
              query: { email: 'test@example.com' },
              body: { password: 'pass' },
              timestamp: '2026-06-03T20:00:00Z',
            },
            response: {
              status: 200,
              headers: { 'set-cookie': 'secret' },
              body: { secretData: 'ok' },
              durationMs: 45,
            },
            errors: [],
            queries: [],
          },
        ],
      };

      const latencies = new Map();
      latencies.set('GET:/api/users', {
        method: 'GET',
        route: '/api/users',
        count: 1,
        p50: 45,
        p95: 45,
        p99: 45,
        avg: 45,
      });

      const security = [
        {
          id: 'sec-auth-GET--api-users',
          severity: 'medium',
          category: 'auth',
          route: '/api/users',
          method: 'GET',
          title: 'Route Lacks Authentication',
          description: 'No auth middleware detected.',
          remediation: 'Attach auth plugin.',
        },
      ];

      const contracts = [
        {
          route: '/api/users',
          method: 'GET',
          status: 'passed',
          passed: true,
          violations: [],
        },
      ];

      const context = buildContext(
        discovery,
        session,
        latencies,
        security,
        contracts,
      );

      expect(context.routes.length).toBe(1);
      expect(context.routes[0].path).toBe('/api/users');
      expect(context.routes[0].hasValidation).toBe(true);

      expect(context.performance.length).toBe(1);
      expect(context.performance[0].p95).toBe(45);

      expect(context.security.length).toBe(1);
      expect(context.security[0].severity).toBe('medium');

      expect(context.contracts.length).toBe(1);
      expect(context.contracts[0].passed).toBe(true);

      expect(context.recentTraffic.length).toBe(1);
      expect(context.recentTraffic[0].request.headers.authorization).toBe(
        '[REDACTED]',
      );
      expect(context.recentTraffic[0].request.query.email).toBe('[REDACTED]');
      expect(context.recentTraffic[0].request.body.password).toBe('[REDACTED]');
      expect(context.recentTraffic[0].response.headers['set-cookie']).toBe(
        '[REDACTED]',
      );
    });
  });
});
