/**
 * `axiomify sdk generate`
 *
 * Scans an input specification (Axiomify app, OpenAPI, or GraphQL) and
 * generates SDK client code for the specified target languages.
 */
import fs from 'fs/promises';
import path from 'path';
import pc from 'picocolors';
import { CompilerPipeline } from '../../sdk/compiler/pipeline';
import { GeneratorRegistry } from '../../sdk/generator';
import { ingestAxiomifyApp, ingestGraphQL, ingestOpenApi, ingestAsyncApi } from '../../sdk/ingest';
import { symbols } from '../../utils/format';
import { loadApp } from '../../utils/load-app';

// Import built-in generators so they register themselves
import '../../sdk/generator/targets/dart';
import '../../sdk/generator/targets/go';
import '../../sdk/generator/targets/javascript';
import '../../sdk/generator/targets/kotlin';
import '../../sdk/generator/targets/python';
import '../../sdk/generator/targets/swift';
import '../../sdk/generator/targets/typescript';

export interface GenerateOptions {
  input: string;
  target: string[];
  output: string;
  name?: string;
  version?: string;
  runtime?: boolean;
  dryRun?: boolean;
  exitOnError?: boolean;
}

export async function generateSdk(opts: GenerateOptions): Promise<boolean> {
  const startTime = Date.now();
  console.log(`\n${symbols.info} Initializing SDK compilation...\n`);

  // Containment check for output directory
  const projectRoot = path.resolve(process.cwd());
  const resolvedOutput = path.resolve(projectRoot, opts.output);
  const relative = path.relative(projectRoot, resolvedOutput);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    console.error(pc.red(`✗ Output directory "${opts.output}" must be contained within the project root directory ("${projectRoot}").`));
    if (opts.exitOnError !== false) process.exit(1);
    return false;
  }

  // 1. Ingestion
  let ingestionResult;
  const inputExt = path.extname(opts.input).toLowerCase();

  try {
    if (inputExt === '.ts' || inputExt === '.js') {
      // Ingest Axiomify app directly
      console.log(`  ${symbols.bullet} Ingesting Axiomify app from ${pc.cyan(opts.input)}...`);
      const rootAbs = path.resolve(process.cwd(), opts.input);
      const { app, cleanup } = await loadApp(rootAbs);
      ingestionResult = ingestAxiomifyApp(app, { title: opts.name, version: opts.version });
      await cleanup();
    } else if (inputExt === '.json' || inputExt === '.yaml' || inputExt === '.yml') {
      const raw = await fs.readFile(path.resolve(process.cwd(), opts.input), 'utf8');
      
      let parsed;
      if (inputExt === '.json') {
        parsed = JSON.parse(raw);
      } else {
        const yaml = require('yaml');
        parsed = yaml.parse(raw);
      }

      if (parsed && typeof parsed === 'object' && 'asyncapi' in parsed) {
        console.log(`  ${symbols.bullet} Ingesting AsyncAPI spec from ${pc.cyan(opts.input)}...`);
        ingestionResult = ingestAsyncApi(parsed, { title: opts.name, version: opts.version });
      } else {
        console.log(`  ${symbols.bullet} Ingesting OpenAPI spec from ${pc.cyan(opts.input)}...`);
        ingestionResult = ingestOpenApi(parsed, { title: opts.name, version: opts.version });
      }
    } else if (inputExt === '.graphql' || inputExt === '.gql') {
       // GraphQL
       console.log(`  ${symbols.bullet} Ingesting GraphQL SDL from ${pc.cyan(opts.input)}...`);
       const raw = await fs.readFile(path.resolve(process.cwd(), opts.input), 'utf8');
       ingestionResult = await ingestGraphQL(raw, { title: opts.name, version: opts.version });
    } else {
      console.error(pc.red(`✗ Unsupported input type: ${inputExt}. Use .ts (App), .json/.yaml (OpenAPI), or .graphql (GraphQL)`));
      if (opts.exitOnError !== false) process.exit(1);
      return false;
    }
  } catch (err: any) {
    console.error(pc.red(`✗ Ingestion failed: ${err.message}`));
    if (opts.exitOnError !== false) process.exit(1);
    return false;
  }

  if (ingestionResult.diagnostics.length > 0) {
     for (const d of ingestionResult.diagnostics) {
       if (d.severity === 'error') console.error(pc.red(`  [Error] ${d.code}: ${d.message}`));
       else if (d.severity === 'warning') console.warn(pc.yellow(`  [Warn] ${d.code}: ${d.message}`));
     }
     if (ingestionResult.diagnostics.some((d: any) => d.severity === 'error')) {
        if (opts.exitOnError !== false) process.exit(1);
        return false;
     }
  }

  // 2. Compilation
  console.log(`  ${symbols.bullet} Compiling IR schema...`);
  const compiler = new CompilerPipeline();
  const compilation = await compiler.compile(ingestionResult.schema);

  if (compilation.hasErrors) {
     for (const d of compilation.diagnostics) {
       if (d.severity === 'error') console.error(pc.red(`  [Error] ${d.code}: ${d.message}`));
     }
     console.error(pc.red(`\n✗ Compilation failed.`));
     if (opts.exitOnError !== false) process.exit(1);
     return false;
  }

  console.log(`  ${symbols.ok} IR compiled successfully in ${compilation.durationMs}ms`);
  console.log(pc.dim(`      (${compilation.schema.endpoints.length} endpoints, ${compilation.schema.types.size} types)`));

  // 3. Code Generation
  for (const t of opts.target) {
     const GeneratorClass = GeneratorRegistry.get(t);
     if (!GeneratorClass) {
        console.error(pc.red(`\n✗ Unknown generator target: "${t}"`));
        console.error(`  Available targets: ${GeneratorRegistry.targets().join(', ')}`);
        continue;
     }

     console.log(`\n  ${symbols.bullet} Generating ${pc.cyan(t)} SDK...`);
     
     const outDir = path.resolve(process.cwd(), opts.output, t);
     const generator = new GeneratorClass(compilation.schema, {
       packageName: opts.name || `axiomify-sdk-${t}`,
       outputDir: outDir,
       version: opts.version || compilation.schema.info.version,
       runtime: opts.runtime !== false,
     });

     try {
       const files = await generator.generate();
       
       if (opts.dryRun) {
          console.log(`  ${symbols.ok} [Dry Run] Would write ${files.length} files to ${path.relative(process.cwd(), outDir)}`);
          for (const f of files) console.log(pc.dim(`      - ${f.path} (${f.content.length} bytes)`));
       } else {
          await fs.mkdir(outDir, { recursive: true });
          for (const f of files) {
             const fullPath = path.join(outDir, f.path);
             await fs.mkdir(path.dirname(fullPath), { recursive: true });
             await fs.writeFile(fullPath, f.content, 'utf8');
             console.log(pc.dim(`      Wrote ${f.path}`));
          }
          console.log(`  ${symbols.ok} Wrote ${files.length} files to ${path.relative(process.cwd(), outDir)}`);
       }
     } catch (err: any) {
        console.error(pc.red(`  ✗ Generator failed: ${err.message}`));
     }
  }

  const totalTime = Date.now() - startTime;
  console.log(`\n${symbols.ok} Done in ${totalTime}ms.\n`);
  return true;
}
