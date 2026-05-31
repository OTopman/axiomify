import { Command } from 'commander';
import { readFileSync } from 'fs';
import pc from 'picocolors';
import { CompilerPipeline } from '../../sdk/compiler/pipeline';
import { ingestGraphQL, ingestOpenApi } from '../../sdk/ingest';

export function registerSdkValidateCommand(program: Command) {
  program
    .command('validate')
    .description('Validate an API schema against the Axiomify SDK compiler')
    .argument(
      '<input>',
      'The input schema file (e.g. spec.json, schema.graphql)',
    )
    .action(async (input: string) => {
      try {
        console.log(pc.blue('ℹ Initializing SDK validator...\n'));
        console.log(pc.dim(`  • Loading ${input}...`));
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

        console.log(pc.dim('  • Compiling IR schema...'));
        const pipeline = new CompilerPipeline();
        ir = (await pipeline.compile(ir.schema)).schema;

        console.log(pc.green(`  ✓ Schema is valid!`));
        console.log(pc.dim(`      Endpoints: ${ir.endpoints.length}`));
        console.log(pc.dim(`      Types: ${ir.types.size}`));
        console.log(pc.green('\n✓ Done.'));
      } catch (err: any) {
        console.error(pc.red(`\n✗ Validation failed: ${err.message}`));
        if (err.stack) console.error(pc.dim(err.stack));
        process.exit(1);
      }
    });
}
