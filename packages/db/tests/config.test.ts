import { describe, it, expect, afterAll } from 'vitest';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { defineDbConfig, loadDbConfig, DB_CONFIG_FILES } from '../src/config';

const tempDirs: string[] = [];

async function tempProject(files: Record<string, string>): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'axiomify-db-test-'));
  tempDirs.push(dir);
  for (const [name, content] of Object.entries(files)) {
    await fs.writeFile(path.join(dir, name), content, 'utf8');
  }
  return dir;
}

afterAll(async () => {
  await Promise.all(
    tempDirs.map((dir) => fs.rm(dir, { recursive: true, force: true })),
  );
});

describe('defineDbConfig', () => {
  it('returns the config unchanged (typed identity)', () => {
    const config = {
      version: 1 as const,
      commands: { migrate: 'prisma migrate deploy', seed: () => 'seeded' },
    };
    expect(defineDbConfig(config)).toBe(config);
  });

  it('accepts a minimal config with no commands', () => {
    expect(defineDbConfig({ version: 1 })).toEqual({ version: 1 });
  });

  it('rejects non-objects, missing and unsupported versions', () => {
    expect(() => defineDbConfig(null as never)).toThrow(/expected an object/);
    expect(() => defineDbConfig([] as never)).toThrow(/expected an object/);
    expect(() => defineDbConfig({} as never)).toThrow(
      /missing required "version"/,
    );
    expect(() => defineDbConfig({ version: 2 } as never)).toThrow(
      /unsupported version 2/,
    );
  });

  it('rejects malformed commands', () => {
    expect(() => defineDbConfig({ version: 1, commands: [] } as never)).toThrow(
      /"commands" must be an object/,
    );
    expect(() =>
      defineDbConfig({ version: 1, commands: { deploy: 'x' } } as never),
    ).toThrow(/unknown command "deploy".*migrate, seed, generate/);
    expect(() =>
      defineDbConfig({ version: 1, commands: { migrate: '  ' } } as never),
    ).toThrow(/must not be an empty string/);
    expect(() =>
      defineDbConfig({ version: 1, commands: { seed: 42 } } as never),
    ).toThrow(/command "seed" must be a string or function/);
  });
});

describe('loadDbConfig', () => {
  it('requires a directory path', async () => {
    await expect(loadDbConfig('')).rejects.toThrow(/requires a directory/);
  });

  it('resolves null when no manifest exists', async () => {
    const dir = await tempProject({});
    await expect(loadDbConfig(dir)).resolves.toBeNull();
  });

  it('loads and validates axiomify.db.json', async () => {
    const dir = await tempProject({
      'axiomify.db.json': JSON.stringify({
        version: 1,
        commands: {
          migrate: 'prisma migrate deploy',
          generate: 'prisma generate',
        },
      }),
    });
    const loaded = await loadDbConfig(dir);
    expect(loaded).toMatchObject({
      format: 'json',
      path: path.join(dir, 'axiomify.db.json'),
      config: {
        version: 1,
        commands: {
          migrate: 'prisma migrate deploy',
          generate: 'prisma generate',
        },
      },
    });
  });

  it('loads axiomify.db.mjs via dynamic import (default export)', async () => {
    const dir = await tempProject({
      'axiomify.db.mjs': `
        export default {
          version: 1,
          commands: {
            migrate: 'drizzle-kit migrate',
            seed: async () => 'seeded',
          },
        };
      `,
    });
    const loaded = await loadDbConfig(dir);
    expect(loaded?.format).toBe('mjs');
    expect(loaded?.config.version).toBe(1);
    expect(loaded?.config.commands?.migrate).toBe('drizzle-kit migrate');
    expect(typeof loaded?.config.commands?.seed).toBe('function');
    await expect(
      (loaded?.config.commands?.seed as () => Promise<string>)(),
    ).resolves.toBe('seeded');
  });

  it('falls back to a named `config` export in .mjs manifests', async () => {
    const dir = await tempProject({
      'axiomify.db.mjs': `export const config = { version: 1 };`,
    });
    const loaded = await loadDbConfig(dir);
    expect(loaded?.config).toEqual({ version: 1 });
  });

  it('errors when both manifests exist', async () => {
    const dir = await tempProject({
      'axiomify.db.json': '{"version":1}',
      'axiomify.db.mjs': 'export default { version: 1 };',
    });
    await expect(loadDbConfig(dir)).rejects.toThrow(
      /Found both axiomify\.db\.json and axiomify\.db\.mjs/,
    );
  });

  it('errors clearly on malformed JSON', async () => {
    const dir = await tempProject({ 'axiomify.db.json': '{ version: 1 ' });
    await expect(loadDbConfig(dir)).rejects.toThrow(
      /Failed to parse .*axiomify\.db\.json/,
    );
  });

  it('errors clearly on schema violations in JSON', async () => {
    const badVersion = await tempProject({
      'axiomify.db.json': '{"version": 99}',
    });
    await expect(loadDbConfig(badVersion)).rejects.toThrow(
      /unsupported version 99/,
    );

    const badCommand = await tempProject({
      'axiomify.db.json': '{"version": 1, "commands": {"migrate": 5}}',
    });
    // JSON manifests may not use functions, so the error offers only string.
    await expect(loadDbConfig(badCommand)).rejects.toThrow(
      /command "migrate" must be a string, got type "number"/,
    );
  });

  it('errors when the .mjs module fails to import', async () => {
    const dir = await tempProject({
      'axiomify.db.mjs': 'export default {{{ syntax error',
    });
    await expect(loadDbConfig(dir)).rejects.toThrow(
      /Failed to import .*axiomify\.db\.mjs/,
    );
  });

  it('errors when the .mjs module has no default export', async () => {
    const dir = await tempProject({
      'axiomify.db.mjs': 'export const somethingElse = 1;',
    });
    await expect(loadDbConfig(dir)).rejects.toThrow(/no default export/);
  });

  it('validates .mjs configs against the schema', async () => {
    const dir = await tempProject({
      'axiomify.db.mjs':
        'export default { version: 1, commands: { nuke: "rm -rf" } };',
    });
    await expect(loadDbConfig(dir)).rejects.toThrow(/unknown command "nuke"/);
  });

  it('picks up manifest edits between loads (cache-busted import)', async () => {
    const dir = await tempProject({
      'axiomify.db.mjs':
        'export default { version: 1, commands: { seed: "one" } };',
    });
    const first = await loadDbConfig(dir);
    expect(first?.config.commands?.seed).toBe('one');
    await fs.writeFile(
      path.join(dir, 'axiomify.db.mjs'),
      'export default { version: 1, commands: { seed: "two" } };',
    );
    const second = await loadDbConfig(dir);
    expect(second?.config.commands?.seed).toBe('two');
  });

  it('exposes the manifest file names for the CLI', () => {
    expect(DB_CONFIG_FILES).toEqual(['axiomify.db.json', 'axiomify.db.mjs']);
  });
});
