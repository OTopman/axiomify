import { Command } from 'commander';
import { readFileSync } from 'fs';
import { ingestOpenApi, ingestGraphQL } from '../../sdk/ingest';
import { CompilerPipeline } from '../../sdk/compiler/pipeline';
import { SchemaDiffer, BreakingChangeAnalyzer, MigrationEngine } from '../../sdk/diff';
import pc from 'picocolors';

export function registerSdkMigrateCommand(program: Command) {
  program
    .command('migrate')
    .description('Generate client migration steps and guides between two API schemas')
    .argument('<old>', 'The old/previous schema file')
    .argument('<new>', 'The new/current schema file')
    .option('--json', 'Output migration guide as JSON', false)
    .action(async (oldFile: string, newFile: string, options: { json: boolean }) => {
      try {
        if (!options.json) {
          console.log(pc.blue('ℹ Initializing SDK client migration generator...\n'));
        }

        const loadSchema = async (filePath: string) => {
          const ext = filePath.split('.').pop()?.toLowerCase() || '';
          const raw = readFileSync(filePath, 'utf8');
          let ingested;
          if (ext === 'json' || ext === 'yaml' || ext === 'yml') {
            const parsed = ext === 'json' ? JSON.parse(raw) : require('yaml').parse(raw);
            ingested = ingestOpenApi(parsed, {});
          } else if (ext === 'graphql' || ext === 'gql') {
            ingested = await ingestGraphQL(raw, {});
          } else {
            throw new Error(`Unsupported schema format for ${filePath}`);
          }
          return (await new CompilerPipeline().compile(ingested.schema)).schema;
        };

        const oldSchema = await loadSchema(oldFile);
        const newSchema = await loadSchema(newFile);

        const differ = new SchemaDiffer();
        const diffs = differ.diff(oldSchema, newSchema);

        const analyzer = new BreakingChangeAnalyzer();
        const report = analyzer.analyze(diffs);

        const migrator = new MigrationEngine();
        const steps = migrator.generateMigrationGuide(diffs, report);

        if (options.json) {
          console.log(JSON.stringify(steps, null, 2));
        } else {
          console.log(pc.bold(`Migration Guide: ${oldFile} → ${newFile}`));
          console.log(pc.dim(`Total action items: ${steps.length}\n`));

          if (steps.length === 0) {
            console.log(pc.green('  ✓ No client code migration is necessary. Upgrade is fully backward compatible.'));
          } else {
            for (const step of steps) {
              const symbol = step.action === 'remove' ? '❌' : '⚠️';
              console.log(`  ${symbol} [${step.action.toUpperCase()}] Target: ${pc.cyan(step.target)}`);
              console.log(`      ${step.description}`);
              console.log();
            }
          }
        }
      } catch (err: any) {
        console.error(pc.red(`\n✗ Migration generation failed: ${err.message}`));
        process.exit(1);
      }
    });
}
