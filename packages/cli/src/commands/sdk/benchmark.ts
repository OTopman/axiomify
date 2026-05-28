import { Command } from 'commander';
import pc from 'picocolors';
import { CompilerPipeline } from '../../sdk/compiler/pipeline';
import { GeneratorRegistry } from '../../sdk/generator';
import type { IRSchema, IRType } from '../../sdk/ir/types';

export function registerSdkBenchmarkCommand(program: Command) {
  program
    .command('benchmark')
    .description('Benchmark the compiler and code generator throughput')
    .action(async () => {
      console.log(pc.blue('ℹ Initializing SDK compiler & generator performance benchmark...\n'));

      // 1. Synthesize a large mock schema (50 endpoints, 100 object types)
      console.log(pc.dim('  • Synthesizing mock schema (50 endpoints, 100 types)...'));
      const mockSchema: IRSchema = {
        info: { title: 'Benchmark API', version: '2.0.0', sourceFormat: 'openapi' },
        types: new Map<string, IRType>(),
        endpoints: [],
        securitySchemes: new Map(),
        servers: [],
        globalSecurity: [],
        events: [],
        reactiveContracts: []
      };

      // Generate 100 objects
      for (let i = 1; i <= 100; i++) {
        const typeId = `Model${i}`;
        mockSchema.types.set(typeId, {
          id: typeId,
          kind: 'object',
          fields: [
            { name: 'id', required: true, type: { inline: { id: '_string', kind: 'scalar', scalar: 'string' } } },
            { name: 'name', required: true, type: { inline: { id: '_string', kind: 'scalar', scalar: 'string' } } },
            { name: 'age', required: false, type: { inline: { id: '_number', kind: 'scalar', scalar: 'number' } } },
            { name: 'createdAt', required: true, type: { inline: { id: '_datetime', kind: 'scalar', scalar: 'datetime' } } }
          ]
        });
      }

      // Generate 50 endpoints
      for (let i = 1; i <= 50; i++) {
        const opId = `getEndpoint${i}`;
        mockSchema.endpoints.push({
          operationId: opId,
          transport: 'rest',
          method: 'GET',
          path: `/resource/${i}/{id}`,
          pathParams: [
            { name: 'id', location: 'path', required: true, type: { inline: { id: '_string', kind: 'scalar', scalar: 'string' } } }
          ],
          queryParams: [],
          headerParams: [],
          responses: {
            '200': {
              statusCode: '200',
              description: 'Success',
              type: { ref: `Model${(i * 2) % 100 || 100}` }
            }
          },
          successResponse: '200',
          security: [],
          tags: ['benchmark']
        });
      }

      // 2. Measure Compilation
      console.log(pc.dim('  • Benchmarking CompilerPipeline...'));
      const startCompile = Date.now();
      const pipeline = new CompilerPipeline();
      const compResult = await pipeline.compile(mockSchema);
      const compileTime = Date.now() - startCompile;

      if (compResult.hasErrors) {
        console.error(pc.red('✗ Benchmark compilation failed!'));
        process.exit(1);
      }

      // 3. Measure Generators
      console.log(pc.dim('  • Benchmarking target language generators...'));
      const startGen = Date.now();
      const targets = GeneratorRegistry.targets();
      let totalFiles = 0;

      for (const t of targets) {
        const GenClass = GeneratorRegistry.get(t)!;
        const generator = new GenClass(compResult.schema, {
          packageName: `benchmark-sdk-${t}`,
          outputDir: 'dummy',
          version: '1.0.0'
        });
        const files = await generator.generate();
        totalFiles += files.length;
      }
      const genTime = Date.now() - startGen;

      // 4. Report metrics
      console.log(pc.green('\n✓ Benchmark completed successfully.'));
      console.log();
      console.log(pc.bold('Results Summary:'));
      console.log(pc.dim(`  - Compilation Time: ${compileTime}ms`));
      console.log(pc.dim(`  - Generation Time (all ${targets.length} targets): ${genTime}ms`));
      console.log(pc.dim(`  - Total files generated: ${totalFiles}`));
      console.log(pc.dim(`  - Compilation Throughput: ${(50 / (compileTime / 1000)).toFixed(2)} endpoints/sec`));
      console.log(pc.dim(`  - Generation Throughput: ${(totalFiles / (genTime / 1000)).toFixed(2)} files/sec`));
    });
}
