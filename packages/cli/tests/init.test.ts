import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initProject } from '../src/commands/init';

// Answer the interactive prompts non-interactively. useGit/installDeps are
// off so the test never shells out to git or a package manager.
vi.mock('enquirer', () => ({
  prompt: vi.fn(async () => ({
    description: 'A production-ready Axiomify service',
    useEslint: false,
    packageManager: 'npm',
    useGit: false,
    installDeps: false,
  })),
}));

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'axiomify-init-test-'));
  // Silence command output — the assertions are on the generated files,
  // not on the pretty console rendering.
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(async () => {
  vi.restoreAllMocks();
  await rm(dir, { recursive: true, force: true });
});

describe('initProject', () => {
  it('scaffolds the project skeleton', async () => {
    const target = path.join(dir, 'my-app');
    await initProject(target);

    expect(existsSync(path.join(target, 'package.json'))).toBe(true);
    expect(existsSync(path.join(target, 'tsconfig.json'))).toBe(true);
    expect(existsSync(path.join(target, 'src', 'index.ts'))).toBe(true);
    expect(existsSync(path.join(target, '.gitignore'))).toBe(true);
  });

  it('wires @axiomify/testing + vitest into the generated project', async () => {
    const target = path.join(dir, 'my-app');
    await initProject(target);

    const pkg = JSON.parse(
      await readFile(path.join(target, 'package.json'), 'utf8'),
    );
    expect(pkg.scripts.test).toBe('vitest run');
    expect(pkg.devDependencies.vitest).toBeDefined();
    expect(pkg.devDependencies['@axiomify/testing']).toBeDefined();
    // @axiomify/* devDependencies track the CLI's own version.
    expect(pkg.devDependencies['@axiomify/testing']).toBe(
      pkg.devDependencies['@axiomify/cli'],
    );
  });

  it('generates a test suite targeting the scaffolded /health route', async () => {
    const target = path.join(dir, 'my-app');
    await initProject(target);

    const testFile = await readFile(
      path.join(target, 'tests', 'app.test.ts'),
      'utf8',
    );
    expect(testFile).toContain(
      "import { createTestClient } from '@axiomify/testing';",
    );
    expect(testFile).toContain("import { app } from '../src/index';");
    expect(testFile).toContain("client.get('/health')");

    // The route the test targets must actually exist in the scaffold.
    const indexTs = await readFile(
      path.join(target, 'src', 'index.ts'),
      'utf8',
    );
    expect(indexTs).toContain("path: '/health'");
    expect(indexTs).toContain('export const app');
  });
});
