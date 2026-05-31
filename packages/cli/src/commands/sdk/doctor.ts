import { Command } from 'commander';
import { execSync } from 'child_process';
import pc from 'picocolors';

export function registerSdkDoctorCommand(program: Command) {
  program
    .command('doctor')
    .description(
      'Verify and diagnose local toolchains required for SDK targets',
    )
    .action(async () => {
      console.log(pc.blue('ℹ Diagnosing local SDK target toolchains...\n'));

      const toolchains = [
        {
          name: 'TypeScript/JavaScript (Node.js)',
          cmd: 'node --version',
          req: 'Node.js',
        },
        {
          name: 'Python (pip/pydantic)',
          cmd: 'python3 --version',
          req: 'Python 3',
        },
        { name: 'Go (compiler)', cmd: 'go version', req: 'Go SDK' },
        { name: 'Dart (flutter/pub)', cmd: 'dart --version', req: 'Dart SDK' },
        { name: 'Kotlin (gradle/java)', cmd: 'java -version', req: 'Java JDK' },
        {
          name: 'Swift (swiftc/xcode)',
          cmd: 'swift --version',
          req: 'Swift / Xcode Command Line Tools',
        },
      ];

      let allOk = true;

      for (const tc of toolchains) {
        try {
          const out = execSync(tc.cmd, { stdio: 'pipe' })
            .toString()
            .trim()
            .split('\n')[0];
          console.log(pc.green(`  ✓ ${tc.name}: Detected [${out}]`));
        } catch (err) {
          console.log(pc.red(`  ✗ ${tc.name}: Missing! (Requires: ${tc.req})`));
          allOk = false;
        }
      }

      if (allOk) {
        console.log(
          pc.green('\n✓ Doctor check passed. All toolchains are available.'),
        );
      } else {
        console.log(
          pc.yellow(
            '\n⚠ Some toolchains are missing. You may not be able to build or publish certain targets.',
          ),
        );
      }
    });
}
