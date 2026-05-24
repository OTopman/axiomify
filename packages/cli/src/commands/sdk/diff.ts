import { Command } from 'commander';
import { readFileSync } from 'fs';
import { ingestOpenApi, ingestGraphQL } from '../../sdk/ingest';
import { CompilerPipeline } from '../../sdk/compiler/pipeline';
import { SchemaDiffer } from '../../sdk/diff/differ';
import { BreakingChangeAnalyzer } from '../../sdk/diff/breaking-changes';
import pc from 'picocolors';

export interface DiffOptions {
  old: string;
  new: string;
}

export function registerSdkDiffCommand(program: Command) {
  program
    .command('diff')
    .description('Compare two API schemas for breaking changes')
    .argument('<old>', 'The old/previous schema file')
    .argument('<new>', 'The new/current schema file')
    .action(async (oldFile: string, newFile: string) => {
      try {
        console.log(pc.blue('ℹ Initializing SDK differ...\n'));
        
        console.log(pc.dim(`  • Loading ${oldFile}...`));
        const oldExt = oldFile.split('.').pop()?.toLowerCase() || '';
        let oldIr;
        const oldRaw = readFileSync(oldFile, 'utf8');
        if (oldExt === 'json' || oldExt === 'yaml' || oldExt === 'yml') {
           const parsed = oldExt === 'json' ? JSON.parse(oldRaw) : require('yaml').parse(oldRaw);
           oldIr = ingestOpenApi(parsed, {});
        } else if (oldExt === 'graphql' || oldExt === 'gql') {
           oldIr = await ingestGraphQL(oldRaw, {});
        } else {
           throw new Error(`Unsupported extension for ${oldFile}`);
        }
        oldIr = new CompilerPipeline().compile(oldIr.schema).schema;

        console.log(pc.dim(`  • Loading ${newFile}...`));
        const newExt = newFile.split('.').pop()?.toLowerCase() || '';
        let newIr;
        const newRaw = readFileSync(newFile, 'utf8');
        if (newExt === 'json' || newExt === 'yaml' || newExt === 'yml') {
           const parsed = newExt === 'json' ? JSON.parse(newRaw) : require('yaml').parse(newRaw);
           newIr = ingestOpenApi(parsed, {});
        } else if (newExt === 'graphql' || newExt === 'gql') {
           newIr = await ingestGraphQL(newRaw, {});
        } else {
           throw new Error(`Unsupported extension for ${newFile}`);
        }
        newIr = new CompilerPipeline().compile(newIr.schema).schema;

        console.log(pc.dim('  • Computing diff...\n'));

        const differ = new SchemaDiffer();
        const diffs = differ.diff(oldIr, newIr);

        const analyzer = new BreakingChangeAnalyzer();
        const report = analyzer.analyze(diffs);

        const breaking = report.issues.filter(i => i.severity === 'breaking');
        const nonBreaking = report.issues.filter(i => i.severity !== 'breaking');

        if (breaking.length === 0 && nonBreaking.length === 0) {
           console.log(pc.green('  ✓ No changes detected between schemas.'));
        } else {
           if (breaking.length > 0) {
              console.log(pc.red(`  ✗ Found ${breaking.length} breaking changes:`));
              breaking.forEach(b => console.log(pc.red(`      - ${b.description}`)));
           } else {
              console.log(pc.green('  ✓ No breaking changes detected.'));
           }

           if (nonBreaking.length > 0) {
              console.log(pc.yellow(`\n  ⚠ Found ${nonBreaking.length} non-breaking changes:`));
              nonBreaking.forEach(nb => console.log(pc.yellow(`      - ${nb.description}`)));
           }
        }
        
        console.log(pc.green('\n✓ Done.'));
        if (report.isBreaking) {
           process.exit(1);
        }
      } catch (err: any) {
        console.error(pc.red(`\n✗ Diff failed: ${err.message}`));
        process.exit(1);
      }
    });
}
