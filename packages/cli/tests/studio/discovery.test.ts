import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Axiomify } from '@axiomify/core';
import { z } from 'zod';
import { performDiscovery } from '../../src/studio/discovery';
import { discoverRoutes } from '../../src/studio/discovery/route-discovery';
import { discoverSchemas } from '../../src/studio/discovery/schema-discovery';
import { discoverHooks } from '../../src/studio/discovery/hook-discovery';
import { discoverHealth } from '../../src/studio/discovery/health-discovery';

describe('Studio Discovery Engine', () => {
  let tempDir: string;
  let cwdSpy: any;

  beforeEach(async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const crypto = await import('node:crypto');
    tempDir = path.resolve(__dirname, `temp-discovery-${crypto.randomUUID()}`);
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(tempDir);
  });

  afterEach(async () => {
    const fs = await import('node:fs');
    cwdSpy.mockRestore();
    try {
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    } catch {}
  });
  it('should handle an empty app instance', async () => {
    const app = new Axiomify();
    const result = await performDiscovery(app);

    expect(result.routes).toEqual([]);
    expect(result.schemas).toEqual([]);
    expect(result.config.httpRouteCount).toBe(0);
    expect(result.config.wsRouteCount).toBe(0);
    expect(result.config.hookCount).toBe(0);
    expect(result.config.serviceCount).toBe(0);
    expect(result.health).toBeDefined();
    expect(result.health.summary.failures).toBe(0);
  });

  it('should discover registered HTTP routes with correct method and path', () => {
    const app = new Axiomify();
    app.route({
      method: 'GET',
      path: '/test-route',
      handler: async () => {},
    });

    const routes = discoverRoutes(app);
    expect(routes).toHaveLength(1);
    expect(routes[0]).toMatchObject({
      method: 'GET',
      path: '/test-route',
      isWs: false,
      validation: [],
      pluginCount: 0,
    });
  });

  it('should discover schemas and convert Zod validations to JSON Schema', () => {
    const app = new Axiomify();
    app.route({
      method: 'POST',
      path: '/submit',
      schema: {
        body: z.object({
          name: z.string(),
          value: z.number(),
        }),
      },
      handler: async () => {},
    });

    const schemas = discoverSchemas(app);
    expect(schemas).toHaveLength(1);
    expect(schemas[0].routeId).toBe('POST:/submit');
    expect(schemas[0].body).toBeDefined();
    expect(schemas[0].body?.properties).toHaveProperty('name');
    expect(schemas[0].body?.properties).toHaveProperty('value');
  });

  it('should discover hooks registered across the lifecycle', () => {
    const app = new Axiomify();
    app.addHook('onRequest', async () => {});
    app.addHook('onPreHandler', async () => {});

    const hooks = discoverHooks(app);
    const onRequest = hooks.find((h) => h.type === 'onRequest');
    const onPreHandler = hooks.find((h) => h.type === 'onPreHandler');

    expect(onRequest?.count).toBe(1);
    expect(onPreHandler?.count).toBe(1);
  });

  describe('Health Checks Discovery', () => {
    it('should warn when app.enableRequestId() is not called', () => {
      const app = new Axiomify();
      const health = discoverHealth(app);
      const reqIdCheck = health.findings.find(f => f.message.includes('enableRequestId'));
      expect(reqIdCheck?.severity).toBe('warn');
    });

    it('should warn when health-check route is missing', () => {
      const app = new Axiomify();
      const health = discoverHealth(app);
      const healthCheck = health.findings.find(f => f.message.includes('health-check'));
      expect(healthCheck?.severity).toBe('warn');
    });

    it('should pass when health-check route is present', () => {
      const app = new Axiomify();
      app.route({
        method: 'GET',
        path: '/health',
        handler: async () => {},
      });
      const health = discoverHealth(app);
      const healthCheck = health.findings.find(f => f.message.includes('health-check'));
      expect(healthCheck?.severity).toBe('ok');
    });

    it('should warn when body schema is defined but response schema is missing', () => {
      const app = new Axiomify();
      app.route({
        method: 'POST',
        path: '/user',
        schema: {
          body: z.object({ username: z.string() })
        },
        handler: async () => {},
      });
      const health = discoverHealth(app);
      const schemaCheck = health.findings.find(f => f.message.includes('response schema'));
      expect(schemaCheck?.severity).toBe('warn');
    });

    it('should fail when deprecated meta or openapi field is used on route definitions', () => {
      const app = new Axiomify();
      const routeDef = {
        method: 'GET',
        path: '/deprecated',
        handler: async () => {},
        meta: { description: 'old' }
      } as any;
      app.route(routeDef);

      const health = discoverHealth(app);
      const metaCheck = health.findings.find(f => f.message.includes('meta:'));
      expect(metaCheck?.severity).toBe('fail');
    });
  });

  it('should discover route plugins and extract function names', () => {
    const app = new Axiomify();
    function testPlugin() {}
    app.route({
      method: 'GET',
      path: '/test-route',
      plugins: [testPlugin],
      handler: async () => {},
    });

    const routes = discoverRoutes(app);
    expect(routes).toHaveLength(1);
    expect(routes[0].plugins).toEqual(['testPlugin']);
  });

  it('should discover env variables and mask sensitive keys', async () => {
    process.env.TEST_SECRET_KEY = 'supersecret';
    process.env.TEST_PUBLIC_VAR = 'publicval';

    const app = new Axiomify();
    const result = await performDiscovery(app);

    expect(result.env).toBeDefined();
    expect(result.env?.TEST_SECRET_KEY).toBe('••••••••');
    expect(result.env?.TEST_PUBLIC_VAR).toBe('publicval');

    delete process.env.TEST_SECRET_KEY;
    delete process.env.TEST_PUBLIC_VAR;
  });

  it('should discover registered services in the DI container and list public methods', async () => {
    const app = new Axiomify();
    class DummyService {
      public testMethod1() {}
      public testMethod2() {}
      private _privateMethod() {}
    }
    
    (app as any)._services.set('dummyService', new DummyService());

    const result = await performDiscovery(app);
    expect(result.services).toBeDefined();
    
    const service = result.services?.find(s => s.token === 'dummyService');
    expect(service).toBeDefined();
    expect(service?.type).toBe('DummyService');
    expect(service?.methods).toContain('testMethod1');
    expect(service?.methods).toContain('testMethod2');
    expect(service?.methods).not.toContain('_privateMethod');
    expect(service?.methods).not.toContain('constructor');
  });

  it('should check OpenAPI drift when file does not exist', async () => {
    const app = new Axiomify();
    const result = await performDiscovery(app);
    
    expect(result.drift).toBeDefined();
    expect(result.drift?.hasFile).toBe(false);
    expect(result.drift?.synced).toBe(false);
    expect(result.drift?.diffs[0]).toContain('Local openapi.json file does not exist');
  });

  it('should check OpenAPI drift and report hasFile is true when openapi.json exists', async () => {
    const app = new Axiomify();
    
    const fs = await import('node:fs');
    const path = await import('node:path');
    
    const filePath = path.resolve(process.cwd(), 'openapi.json');
    const mockSpec = {
      openapi: '3.1.0',
      info: { title: 'Test API', version: '1.0.0' },
      paths: {
        '/test': {
          get: { summary: 'Get Test' }
        }
      }
    };
    
    fs.writeFileSync(filePath, JSON.stringify(mockSpec, null, 2), 'utf8');
    
    try {
      app.route({
        method: 'GET',
        path: '/test',
        handler: async () => {},
      });
      const result = await performDiscovery(app);
      expect(result.drift).toBeDefined();
      expect(result.drift?.hasFile).toBe(true);
    } finally {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    }
  });

  it('should discover events on EventEmitter services', async () => {
    const app = new Axiomify();
    const EventEmitter = require('node:events');
    const emitter = new EventEmitter();
    emitter.on('user.created', () => {});
    emitter.on('user.deleted', () => {});

    // Register emitter in DI container
    (app as any)._services.set('eventEmitter', emitter);

    const result = await performDiscovery(app);
    expect(result.events).toBeDefined();
    expect(result.events?.length).toBeGreaterThanOrEqual(2);

    const createdEvent = result.events?.find(e => e.event === 'user.created');
    expect(createdEvent).toBeDefined();
    expect(createdEvent?.emitterToken).toBe('eventEmitter');
    expect(createdEvent?.listenerCount).toBe(1);
  });

  it('should discover architecture layers (controllers, services, databases)', async () => {
    const app = new Axiomify();
    
    // Set up database, service, repository
    class DatabaseClient {}
    class UserRepository {}
    class UserService {}

    (app as any)._services.set('database', new DatabaseClient());
    (app as any)._services.set('userRepository', new UserRepository());
    (app as any)._services.set('userService', new UserService());

    app.route({
      method: 'GET',
      path: '/users',
      handler: async () => {},
    });

    const result = await performDiscovery(app);
    expect(result.archMap).toBeDefined();
    expect(result.archMap?.length).toBeGreaterThan(0);

    const dbNode = result.archMap?.find(n => n.id === 'service:database');
    const repoNode = result.archMap?.find(n => n.id === 'service:userRepository');
    const serviceNode = result.archMap?.find(n => n.id === 'service:userService');
    const controllerNode = result.archMap?.find(n => n.id === 'controller:GET:/users');

    expect(dbNode?.type).toBe('database');
    expect(repoNode?.type).toBe('repository');
    expect(serviceNode?.type).toBe('service');
    expect(controllerNode?.type).toBe('controller');
  });
});
