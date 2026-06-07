/**
 * Studio SDK Playground — Code Generation & Execution Sandbox.
 */
import { build } from 'esbuild';
import { promises as fs } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import * as path from 'node:path';
import * as vm from 'node:vm';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { CompilerPipeline } from '../../sdk/compiler/pipeline';
import { GeneratorRegistry } from '../../sdk/generator';
import { ingestAxiomifyApp } from '../../sdk/ingest';
import { sendJson } from '../server/http-server';

const execPromise = promisify(exec);

// Ensure generator targets are registered
import '../../sdk/generator/targets/typescript';
import '../../sdk/generator/targets/python';
import '../../sdk/generator/targets/dart';

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    req.on('error', () => resolve(''));
  });
}

// Generate the SDK in-memory
export async function getPlaygroundSdk(app: any, target: string = 'typescript') {
  const ingestion = ingestAxiomifyApp(app, {
    title: 'PlaygroundClient',
    version: '1.0.0',
  });
  const compiler = new CompilerPipeline();
  const compilation = await compiler.compile(ingestion.schema);

  const GeneratorClass = GeneratorRegistry.get(target);
  if (!GeneratorClass) {
    throw new Error(`Generator target "${target}" not found`);
  }

  const generator = new GeneratorClass(compilation.schema, {
    packageName: target === 'typescript' ? '@axiomify/playground-client' : `axiomify_${target}_client`,
    outputDir: '',
    version: '1.0.0',
    runtime: true,
  });

  const files = await generator.generate();

  // Find some REST endpoint to generate a realistic starter snippet
  const restEndpoints = compilation.schema.endpoints.filter((e) => e.transport === 'rest');
  let exampleMethod = '';
  let starterCode = '';

  if (target === 'typescript') {
    if (restEndpoints.length > 0) {
      const ep = restEndpoints[0];
      exampleMethod = `// Example call:\nconst result = await client.${ep.operationId}({});\nconsole.log('Result:', result);\n`;
    } else {
      exampleMethod = `// Example call:\n// const result = await client.getSomeData();\n// console.log(result);\n`;
    }

    starterCode = `import { ApiClient } from './sdk';

const client = new ApiClient({
  baseUrl: 'http://localhost:3000', // Points to the running app
});

(async () => {
  try {
    ${exampleMethod}
  } catch (error) {
    console.error('API Error:', error);
  }
})();
`;
  } else if (target === 'python') {
    if (restEndpoints.length > 0) {
      const ep = restEndpoints[0];
      const snakeMethod = ep.operationId.replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase();
      exampleMethod = `    # Example call:\n    result = await client.${snakeMethod}({})\n    print('Result:', result)\n`;
    } else {
      exampleMethod = `    # Example call:\n    # result = await client.get_some_data()\n    # print(result)\n`;
    }

    starterCode = `import asyncio
from client import ApiClient

async def main():
    client = ApiClient(base_url="http://localhost:3000")
    try:
    ${exampleMethod}
    except Exception as e:
        print("API Error:", e)

if __name__ == "__main__":
    asyncio.run(main())
`;
  } else if (target === 'dart') {
    if (restEndpoints.length > 0) {
      const ep = restEndpoints[0];
      exampleMethod = `    // Example call:\n    final result = await client.${ep.operationId}();\n    print('Result: $result');\n`;
    } else {
      exampleMethod = `    // Example call:\n    // final result = await client.getSomeData();\n    // print(result);\n`;
    }

    starterCode = `import 'lib/client.dart';

void main() async {
  final client = ApiClient(baseUrl: 'http://localhost:3000');
  try {
  ${exampleMethod}
  } catch (e) {
    print('API Error: $e');
  }
}
`;
  }

  return {
    files: files.map((f) => ({ path: f.path, content: f.content })),
    starterCode,
  };
}

export async function handleGetPlaygroundSdk(
  req: IncomingMessage,
  res: ServerResponse,
  app: any,
): Promise<void> {
  try {
    const parsedUrl = new URL(req.url ?? '', 'http://localhost');
    const target = parsedUrl.searchParams.get('target') || 'typescript';
    const result = await getPlaygroundSdk(app, target);
    sendJson(res, result);
  } catch (err: any) {
    sendJson(res, { error: err.message || 'Failed to generate SDK' }, 500);
  }
}

export async function handlePostPlaygroundExecute(
  req: IncomingMessage,
  res: ServerResponse,
  app: any,
): Promise<void> {
  let tmpDir = '';
  try {
    const raw = await readBody(req);
    const body = JSON.parse(raw);
    const { code, target = 'typescript' } = body;

    if (!code) {
      sendJson(res, { error: 'Missing code parameter' }, 400);
      return;
    }

    // 1. Generate SDK files in-memory
    const sdkData = await getPlaygroundSdk(app, target);

    // 2. Write them plus the user code to a temporary directory for bundling
    const randomSuffix = Math.random().toString(36).substring(2, 10);
    tmpDir = path.join(process.cwd(), `.axiomify-playground-tmp-${randomSuffix}`);
    await fs.mkdir(tmpDir, { recursive: true });

    // Write generated SDK files
    for (const file of sdkData.files) {
      const fullPath = path.join(tmpDir, file.path);
      await fs.mkdir(path.dirname(fullPath), { recursive: true });
      await fs.writeFile(fullPath, file.content, 'utf8');
    }

    if (target === 'typescript') {
      // Add index.ts alias as sdk.ts to allow `import { ApiClient } from './sdk'`
      // Export only types, client, and validators to avoid compiling hooks.ts and triggering @tanstack/react-query dependency error
      await fs.writeFile(
        path.join(tmpDir, 'sdk.ts'),
        `export * from './client';\nexport * from './types';\nexport * from './validators';`,
        'utf8',
      );

      // Write user code
      await fs.writeFile(path.join(tmpDir, 'user-code.ts'), code, 'utf8');

      // 3. Bundle with esbuild
      const bundleResult = await build({
        entryPoints: [path.join(tmpDir, 'user-code.ts')],
        bundle: true,
        write: false,
        platform: 'node',
        format: 'cjs',
        external: ['zod', '@axiomify/sdk-runtime', '@tanstack/react-query'],
      });

      const bundledJs = bundleResult.outputFiles?.[0]?.text;
      if (!bundledJs) {
        throw new Error('Bundling failed, no output file generated');
      }

      // 4. Execute bundled JS in child process
      await fs.writeFile(path.join(tmpDir, 'run.js'), bundledJs, 'utf8');

      try {
        const { stdout, stderr } = await execPromise('node run.js', {
          cwd: tmpDir,
          timeout: 5000,
        });
        const logs = stdout ? stdout.trim().split('\n') : [];
        const errors = stderr ? stderr.trim().split('\n') : [];
        sendJson(res, { logs, errors });
      } catch (err: any) {
        const logs = err.stdout ? err.stdout.trim().split('\n') : [];
        const errors = err.stderr ? err.stderr.trim().split('\n') : [err.message || String(err)];
        sendJson(res, { logs, errors });
      }
    } else if (target === 'python') {
      await fs.writeFile(path.join(tmpDir, 'main.py'), code, 'utf8');
      try {
        const { stdout, stderr } = await execPromise('python3 main.py', {
          cwd: tmpDir,
          timeout: 5000,
        });
        const logs = stdout ? stdout.trim().split('\n') : [];
        const errors = stderr ? stderr.trim().split('\n') : [];
        sendJson(res, { logs, errors });
      } catch (err: any) {
        const logs = err.stdout ? err.stdout.trim().split('\n') : [];
        const errors = err.stderr ? err.stderr.trim().split('\n') : [err.message || String(err)];
        sendJson(res, { logs, errors });
      }
    } else if (target === 'dart') {
      await fs.writeFile(path.join(tmpDir, 'main.dart'), code, 'utf8');
      try {
        await execPromise('dart pub get', { cwd: tmpDir, timeout: 10000 });
        const { stdout, stderr } = await execPromise('dart run main.dart', {
          cwd: tmpDir,
          timeout: 5000,
        });
        const logs = stdout ? stdout.trim().split('\n') : [];
        const errors = stderr ? stderr.trim().split('\n') : [];
        sendJson(res, { logs, errors });
      } catch (err: any) {
        const logs = err.stdout ? err.stdout.trim().split('\n') : [];
        const errors = err.stderr ? err.stderr.trim().split('\n') : [err.message || String(err)];
        sendJson(res, { logs, errors });
      }
    }
  } catch (err: any) {
    sendJson(res, { error: err.stack || err.message || 'Execution failed' }, 500);
  } finally {
    // Clean up temporary directory
    if (tmpDir) {
      try {
        await fs.rm(tmpDir, { recursive: true, force: true });
      } catch {
        // ignore cleanup failure
      }
    }
  }
}
