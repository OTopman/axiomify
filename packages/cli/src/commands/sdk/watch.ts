import { Command } from 'commander';
import fs from 'fs';
import pc from 'picocolors';
import { generateSdk } from './generate';

export function registerSdkWatchCommand(program: Command) {
  program
    .command('watch')
    .description('Watch the input API schema file and regenerate SDK targets automatically on changes')
    .argument('<input>', 'The input schema file (e.g. spec.json, schema.graphql)')
    .requiredOption('-t, --target <langs...>', 'Target languages (e.g. typescript python)')
    .option('-o, --output <dir>', 'Output directory', 'generated-sdks')
    .action(async (input: string, options: any) => {
      console.log(pc.blue(`ℹ Starting watch mode on [${input}]`));
      console.log(pc.dim(`  • Targets to generate: ${options.target.join(', ')}`));
      console.log(pc.dim(`  • Output directory: ${options.output}`));

      // Run initial generation
      try {
        await generateSdk({ input, ...options, exitOnError: false });
      } catch (err) {
        // Log error but keep watching
      }

      let debounceTimeout: NodeJS.Timeout | null = null;

      fs.watch(input, (eventType) => {
        if (eventType === 'change') {
          if (debounceTimeout) clearTimeout(debounceTimeout);
          debounceTimeout = setTimeout(async () => {
            console.log(pc.cyan(`\n  • File change detected on [${input}], regenerating...`));
            try {
              await generateSdk({ input, ...options, exitOnError: false });
            } catch (err: any) {
              console.error(pc.red(`  ✗ Regeneration failed: ${err.message}`));
            }
          }, 300);
        }
      });
    });
}
