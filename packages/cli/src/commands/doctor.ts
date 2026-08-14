/**
 * `axiomify doctor` — diagnose the host environment.
 *
 * This is a Node-version / platform / dependency-shape sanity check. It
 * does NOT load the user's app. Run it on a freshly cloned repo or a CI
 * runner to confirm the environment can actually run Axiomify before
 * tracking down test failures that turn out to be an unsupported Node + uWS
 * incompatibility.
 *
 * Output mirrors `axiomify check`: ✓ / ⚠ / ✗ rows with optional hints.
 * Exit code reflects fails only.
 */
import fs from 'fs';
import { createServer } from 'net';
import path from 'path';
import pc from 'picocolors';
import { pluralise, symbols } from '../utils/format';

type Severity = 'ok' | 'warn' | 'fail';

interface Finding {
  severity: Severity;
  area: string;
  message: string;
  hint?: string;
}

function add(findings: Finding[], f: Finding): void {
  findings.push(f);
}

/**
 * Probe whether a TCP port is bindable on the local host. Used to give a
 * cleaner error when `npm run dev` would fail with `EADDRINUSE`.
 */
function probePort(port: number): Promise<'free' | 'busy' | 'denied'> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') resolve('busy');
      else if (err.code === 'EACCES') resolve('denied');
      else resolve('busy');
    });
    server.once('listening', () => {
      server.close(() => resolve('free'));
    });
    server.listen(port, '127.0.0.1');
  });
}

/**
 * Node version compatibility check.
 *
 * The pinned uWS release publishes prebuilts for the supported Node 22 and 24
 * release lines. Odd-numbered releases are intentionally not production
 * targets because their ABI is short-lived.
 */
function checkNodeVersion(findings: Finding[]): void {
  const major = parseInt(process.versions.node.split('.')[0], 10);
  if (major !== 22 && major !== 24) {
    add(findings, {
      severity: 'fail',
      area: 'node',
      message: `Node ${process.versions.node} is not a supported native runtime`,
      hint: 'Use Node 22 or 24 so the pinned uWebSockets.js package can load a prebuilt binary.',
    });
  } else {
    add(findings, {
      severity: 'ok',
      area: 'node',
      message: `Node ${process.versions.node} (uWS prebuilt available)`,
    });
  }
}

/**
 * Platform compatibility for clustering.
 */
function checkPlatform(findings: Finding[]): void {
  if (process.platform === 'linux') {
    add(findings, {
      severity: 'ok',
      area: 'platform',
      message: 'Linux — SO_REUSEPORT clustering supported natively',
    });
  } else {
    add(findings, {
      severity: 'warn',
      area: 'platform',
      message: `${process.platform} — \`listenClustered()\` requires \`allowUserspaceProxy: true\``,
      hint:
        'Clustering on non-Linux falls back to a userspace L4 proxy that adds two ' +
        'event-loop hops per byte. Single-process `listen()` is the recommended path on this OS.',
    });
  }
}

/**
 * Workspace dependency drift — find any `@axiomify/*` packages on different
 * versions. They should all match within a single deployment.
 */
function checkDependencyDrift(findings: Finding[]): void {
  try {
    const pkgPath = path.join(process.cwd(), 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const all = { ...pkg.dependencies, ...pkg.devDependencies };
    const axiomifyDeps = Object.entries(all).filter(([k]) =>
      k.startsWith('@axiomify/'),
    );
    if (axiomifyDeps.length === 0) {
      add(findings, {
        severity: 'warn',
        area: 'deps',
        message: 'No @axiomify/* packages found in package.json',
        hint: 'Run this from the root of a project that uses Axiomify.',
      });
      return;
    }
    // Group by version-ish (strip leading ^/~).
    const versions = new Set(
      axiomifyDeps.map(([, v]) =>
        v.replace(/^[\^~]/, '').replace(/^\*$/, 'workspace'),
      ),
    );
    if (versions.size > 1) {
      add(findings, {
        severity: 'warn',
        area: 'deps',
        message: `@axiomify/* packages are on ${versions.size} different versions`,
        hint:
          'Mixed @axiomify/* versions can cause subtle compat issues. ' +
          'Pin them all to the same version: ' +
          [...versions].join(', '),
      });
    } else {
      add(findings, {
        severity: 'ok',
        area: 'deps',
        message: `${axiomifyDeps.length} @axiomify/* packages aligned (${[...versions][0]})`,
      });
    }
  } catch {
    add(findings, {
      severity: 'warn',
      area: 'deps',
      message: 'Could not read package.json',
      hint: 'Run `axiomify doctor` from a project root.',
    });
  }
}

/**
 * uWS bindings load test. The cheapest way to detect "the wrong Node
 * version + a real uWS install" before the user tries to start a server.
 */
function checkUwsLoads(findings: Finding[]): void {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    require('uWebSockets.js');
    add(findings, {
      severity: 'ok',
      area: 'uws',
      message: 'uWebSockets.js loads successfully',
    });
  } catch (err) {
    const msg = String((err as Error).message ?? err);
    if (msg.includes('Cannot find module')) {
      add(findings, {
        severity: 'warn',
        area: 'uws',
        message: 'uWebSockets.js is not installed in this project',
        hint:
          'It is a peer dependency of `@axiomify/native`. Install via ' +
          '`npm install --save-optional uWebSockets.js` (the package handles platform selection).',
      });
    } else {
      add(findings, {
        severity: 'fail',
        area: 'uws',
        message: 'uWebSockets.js native binding failed to load',
        hint: msg.length > 200 ? msg.slice(0, 200) + '…' : msg,
      });
    }
  }
}

/**
 * Port availability for the most common Axiomify default (3000).
 */
async function checkPortAvailability(findings: Finding[]): Promise<void> {
  const port = parseInt(process.env.PORT ?? '3000', 10);
  const state = await probePort(port);
  if (state === 'free') {
    add(findings, {
      severity: 'ok',
      area: 'port',
      message: `Port ${port} is available on 127.0.0.1`,
    });
  } else if (state === 'busy') {
    add(findings, {
      severity: 'warn',
      area: 'port',
      message: `Port ${port} is already in use`,
      hint: 'Stop the conflicting process or set `PORT` to a different value.',
    });
  } else {
    add(findings, {
      severity: 'warn',
      area: 'port',
      message: `Port ${port}: bind denied (permission)`,
      hint: 'Ports below 1024 typically require root. Use a port ≥ 1024 in development.',
    });
  }
}

/**
 * Some directories that should exist if the user has built recently.
 */
function checkBuildArtifacts(findings: Finding[]): void {
  const dist = path.join(process.cwd(), 'dist');
  if (fs.existsSync(dist)) {
    add(findings, {
      severity: 'ok',
      area: 'build',
      message: 'dist/ exists (recent `axiomify build`)',
    });
  } else {
    add(findings, {
      severity: 'warn',
      area: 'build',
      message: 'No dist/ directory — production build has not been run',
      hint: 'Run `axiomify build` before deploying.',
    });
  }
}

export async function runDoctor(): Promise<void> {
  const findings: Finding[] = [];

  // Synchronous checks first — they're cheap.
  checkNodeVersion(findings);
  checkPlatform(findings);
  checkDependencyDrift(findings);
  checkUwsLoads(findings);
  checkBuildArtifacts(findings);
  // Then the async port probe.
  await checkPortAvailability(findings);

  console.log();
  console.log(pc.bold('  🩺 Axiomify doctor'));
  console.log();

  const sevOrder: Record<Severity, number> = { fail: 0, warn: 1, ok: 2 };
  findings.sort(
    (a, b) =>
      sevOrder[a.severity] - sevOrder[b.severity] ||
      a.area.localeCompare(b.area),
  );

  const sym: Record<Severity, string> = {
    ok: symbols.ok,
    warn: symbols.warn,
    fail: symbols.fail,
  };

  for (const f of findings) {
    const tag = pc.dim(`[${f.area}]`);
    console.log(`  ${sym[f.severity]} ${tag} ${f.message}`);
    if (f.hint && f.severity !== 'ok') {
      const wrapped = f.hint.replace(
        /(.{1,80})(\s+|$)/g,
        '\n      ' + pc.dim('$1'),
      );
      console.log(wrapped);
    }
  }

  const fails = findings.filter((f) => f.severity === 'fail').length;
  const warns = findings.filter((f) => f.severity === 'warn').length;
  const oks = findings.filter((f) => f.severity === 'ok').length;

  console.log();
  console.log(
    `  ${symbols.ok} ${pluralise(oks, 'pass', 'passes')}` +
      pc.dim('  ·  ') +
      (warns > 0
        ? `${symbols.warn} ${pluralise(warns, 'warning')}`
        : pc.dim('0 warnings')) +
      pc.dim('  ·  ') +
      (fails > 0
        ? `${symbols.fail} ${pluralise(fails, 'failure')}`
        : pc.dim('0 failures')),
  );
  console.log();

  if (fails > 0) process.exit(1);
}
