import { Command } from 'commander';
import { readFileSync } from 'fs';
import pc from 'picocolors';
import { CompilerPipeline } from '../../sdk/compiler/pipeline';
import { ingestGraphQL, ingestOpenApi } from '../../sdk/ingest';

export function registerSdkBuildCommand(program: Command) {
  program
    .command('build')
    .description(
      'Build, validate, and check API schema compile target readiness',
    )
    .argument(
      '<input>',
      'The input schema file (e.g. spec.json, schema.graphql)',
    )
    .action(async (input: string) => {
      try {
        console.log(pc.blue('ℹ Initializing SDK build...\n'));
        const ext = input.split('.').pop()?.toLowerCase() || '';
        let ir;
        const raw = readFileSync(input, 'utf8');

        if (ext === 'json' || ext === 'yaml' || ext === 'yml') {
          const parsed =
            ext === 'json' ? JSON.parse(raw) : require('yaml').parse(raw);
          ir = ingestOpenApi(parsed, {});
        } else if (ext === 'graphql' || ext === 'gql') {
          ir = await ingestGraphQL(raw, {});
        } else {
          throw new Error(`Unsupported file extension "${ext}".`);
        }

        console.log(pc.dim('  • Building and optimizing IR schema...'));
        const pipeline = new CompilerPipeline();
        const result = await pipeline.compile(ir.schema);

        if (result.hasErrors) {
          console.error(pc.red(`\n✗ Build failed with compilation errors:`));
          for (const d of result.diagnostics) {
            if (d.severity === 'error') {
              console.error(pc.red(`    - [${d.code}] ${d.message}`));
            }
          }
          process.exit(1);
        }

        console.log(pc.green(`\n✓ Build succeeded!`));
        console.log(
          pc.dim(`      Endpoints: ${result.schema.endpoints.length}`),
        );
        console.log(pc.dim(`      Types: ${result.schema.types.size}`));
        console.log(pc.dim(`      Duration: ${result.durationMs}ms`));
      } catch (err: any) {
        console.error(pc.red(`\n✗ Build failed: ${err.message}`));
        process.exit(1);
      }
    });
}
