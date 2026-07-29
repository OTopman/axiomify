import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  dbStatus,
  detectOrms,
  loadManifest,
  loadManifestFallback,
  runDbAction,
} from '../src/commands/db';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'axiomify-db-test-'));
  // Silence command output — these are e2e-style tests, the assertions are
  // on exit codes / return values, not on the pretty console rendering.
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(async () => {
  vi.restoreAllMocks();
  await rm(dir, { recursive: true, force: true });
});

const writeManifest = (config: unknown) =>
  writeFile(
    path.join(dir, 'axiomify.db.json'),
    JSON.stringify(config, null, 2),
    'utf8',
  );

describe('axiomify db — manifest loading', () => {
  it('returns null when no manifest exists', async () => {
    expect(await loadManifest(dir)).toBeNull();
  });

  it('loads a valid axiomify.db.json manifest', async () => {
    await writeManifest({
      version: 1,
      commands: { migrate: 'node -e "process.exit(0)"' },
    });
    const manifest = await loadManifest(dir);
    expect(manifest).not.toBeNull();
    expect(manifest!.format).toBe('json');
    expect(manifest!.path).toBe(path.join(dir, 'axiomify.db.json'));
    expect(manifest!.commands.migrate).toBe('node -e "process.exit(0)"');
    expect(manifest!.commands.seed).toBeUndefined();
  });

  it('rejects manifests with an unsupported version', async () => {
    await writeManifest({ version: 2, commands: {} });
    await expect(loadManifest(dir)).rejects.toThrow(/version/);
  });

  it('rejects manifests with unknown command names', async () => {
    await writeManifest({ version: 1, commands: { nuke: 'rm -rf /' } });
    await expect(loadManifest(dir)).rejects.toThrow(/nuke/);
  });

  it('rejects when both .json and .mjs manifests exist (ambiguous)', async () => {
    await writeManifest({ version: 1 });
    await writeFile(path.join(dir, 'axiomify.db.mjs'), 'export default {}');
    await expect(loadManifest(dir)).rejects.toThrow(/both/i);
  });

  it('fallback reader refuses .mjs manifests with a pointer to @axiomify/db', async () => {
    await writeFile(
      path.join(dir, 'axiomify.db.mjs'),
      'export default { version: 1 }',
    );
    await expect(loadManifestFallback(dir)).rejects.toThrow(/@axiomify\/db/);
  });

  it('fallback reader rejects malformed JSON', async () => {
    await writeFile(path.join(dir, 'axiomify.db.json'), '{ not json', 'utf8');
    await expect(loadManifestFallback(dir)).rejects.toThrow(/parse/i);
  });

  it('fallback reader rejects non-string commands', async () => {
    await writeManifest({ version: 1, commands: { migrate: 42 } });
    await expect(loadManifestFallback(dir)).rejects.toThrow(/shell string/);
  });
});

describe('axiomify db <migrate|seed|generate>', () => {
  it('runs the configured shell command and returns exit code 0', async () => {
    const marker = path.join(dir, 'migrated.txt');
    await writeManifest({
      version: 1,
      commands: {
        migrate: `node -e 'require("fs").writeFileSync(${JSON.stringify(marker)}, "done")'`,
      },
    });
    const code = await runDbAction('migrate', { cwd: dir });
    expect(code).toBe(0);
    expect(existsSync(marker)).toBe(true);
  });

  it('propagates the child process exit code', async () => {
    await writeManifest({
      version: 1,
      commands: { seed: 'node -e "process.exit(3)"' },
    });
    expect(await runDbAction('seed', { cwd: dir })).toBe(3);
  });

  it('--dry-run prints the command without executing it', async () => {
    const marker = path.join(dir, 'seeded.txt');
    await writeManifest({
      version: 1,
      commands: {
        seed: `node -e 'require("fs").writeFileSync(${JSON.stringify(marker)}, "x")'`,
      },
    });
    const code = await runDbAction('seed', { cwd: dir, dryRun: true });
    expect(code).toBe(0);
    expect(existsSync(marker)).toBe(false);
    const logged = (console.log as any).mock.calls.flat().join('\n');
    expect(logged).toContain('dry-run');
    expect(logged).toContain('seeded.txt');
  });

  it('fails with a suggested manifest when none exists', async () => {
    const code = await runDbAction('migrate', { cwd: dir });
    expect(code).toBe(1);
    const logged = (console.error as any).mock.calls.flat().join('\n');
    expect(logged).toContain('axiomify.db.json');
    expect(logged).toContain('"version": 1');
  });

  it('fails when the requested command is not configured', async () => {
    await writeManifest({
      version: 1,
      commands: { migrate: 'node -e "process.exit(0)"' },
    });
    const code = await runDbAction('generate', { cwd: dir });
    expect(code).toBe(1);
    const logged = (console.error as any).mock.calls.flat().join('\n');
    expect(logged).toContain('generate');
    expect(logged).toContain('migrate'); // lists what IS configured
  });

  it('fails cleanly on an invalid manifest instead of running anything', async () => {
    await writeManifest({ version: 99 });
    expect(await runDbAction('migrate', { cwd: dir })).toBe(1);
  });
});

describe('axiomify db status', () => {
  it('reports the manifest and configured commands', async () => {
    await writeManifest({
      version: 1,
      commands: { migrate: 'npx prisma migrate deploy' },
    });
    const code = await dbStatus({ cwd: dir });
    expect(code).toBe(0);
    const logged = (console.log as any).mock.calls.flat().join('\n');
    expect(logged).toContain('axiomify.db.json');
    expect(logged).toContain('npx prisma migrate deploy');
    expect(logged).toContain('not configured');
  });

  it('detects prisma / drizzle / knex setups when no manifest exists', async () => {
    await mkdir(path.join(dir, 'prisma'));
    await writeFile(path.join(dir, 'prisma', 'schema.prisma'), '');
    await writeFile(path.join(dir, 'drizzle.config.ts'), '');
    await writeFile(path.join(dir, 'knexfile.js'), '');

    const hints = await detectOrms(dir);
    expect(hints.map((h) => h.orm)).toEqual(['prisma', 'drizzle', 'knex']);
    expect(hints[0].suggestion.migrate).toContain('prisma');

    const code = await dbStatus({ cwd: dir });
    expect(code).toBe(0);
    const logged = (console.log as any).mock.calls.flat().join('\n');
    expect(logged).toContain('prisma');
    expect(logged).toContain('drizzle');
    expect(logged).toContain('knex');
    expect(logged).toContain('"version": 1');
  });

  it('suggests a starter manifest when nothing is detected', async () => {
    const code = await dbStatus({ cwd: dir });
    expect(code).toBe(0);
    const logged = (console.log as any).mock.calls.flat().join('\n');
    expect(logged).toContain('axiomify.db.json');
    expect(logged).toContain('"version": 1');
  });

  it('surfaces manifest errors as exit code 1', async () => {
    await writeManifest({ version: 'nope' });
    expect(await dbStatus({ cwd: dir })).toBe(1);
  });
});
