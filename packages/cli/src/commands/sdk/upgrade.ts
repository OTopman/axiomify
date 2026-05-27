import { Command } from 'commander';
import { execSync } from 'child_process';
import pc from 'picocolors';

export function registerSdkUpgradeCommand(program: Command) {
  program
    .command('upgrade')
    .description('Upgrade the local SDK generation target tool and runtime dependencies')
    .option('--dry-run', 'Show command simulation without installing', false)
    .action(async (options: { dryRun: boolean }) => {
      console.log(pc.blue('ℹ Checking for SDK runtime upgrades...\n'));

      const cmd = 'npm install @axiomify/sdk-runtime@latest --save';
      
      if (options.dryRun) {
        console.log(pc.green(`  ✓ Simulation: Would run: ${cmd}`));
      } else {
        console.log(pc.yellow(`  • Running upgrade: ${cmd}`));
        try {
          execSync(cmd, { stdio: 'inherit' });
          console.log(pc.green('\n✓ SDK runtime upgraded successfully.'));
        } catch (err: any) {
          console.error(pc.red(`\n✗ Upgrade failed: ${err.message}`));
        }
      }
    });
}
