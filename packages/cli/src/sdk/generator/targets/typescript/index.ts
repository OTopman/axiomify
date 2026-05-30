import { Generator, type GeneratedFile } from '../../generator';
import { TypeGraph } from '../../../ir/type-graph';
import { TsTypeEmitter } from './type-emitter';
import { TsClientEmitter } from './client-emitter';
import { TsValidatorEmitter } from './validator-emitter';
import { TsReactQueryEmitter } from './react-query-emitter';
import { GeneratorRegistry } from '../../registry';

export class TypeScriptGenerator extends Generator {
  async generate(): Promise<GeneratedFile[]> {
    const graph = TypeGraph.fromSchema(this.schema);

    // 1. Generate types.ts
    const typeEmitter = new TsTypeEmitter(this.schema, graph);
    this.addFile('types.ts', typeEmitter.emitAll());

    // 2. Generate client.ts
    const clientEmitter = new TsClientEmitter(this.schema, 'ApiClient');
    this.addFile('client.ts', clientEmitter.emitAll());

    // 3. Generate validators.ts
    const validatorEmitter = new TsValidatorEmitter(this.schema, graph);
    this.addFile('validators.ts', validatorEmitter.emitAll());

    // 4. Generate hooks.ts (React Query Hooks)
    const hooksEmitter = new TsReactQueryEmitter(this.schema);
    this.addFile('hooks.ts', hooksEmitter.emitAll('ApiClient'));

    // 5. Generate index.ts
    this.addFile(
      'index.ts',
      `export * from './types';\nexport * from './client';\nexport * from './validators';\nexport * from './hooks';\n`,
    );

    // 6. Generate package.json
    this.addFile(
      'package.json',
      JSON.stringify(
        {
          name: this.options.packageName,
          version: this.options.version || '1.0.0',
          main: 'index.ts',
          dependencies: {
            ...(this.options.runtime
              ? { '@axiomify/sdk-runtime': 'latest' }
              : {}),
            zod: '^3.22.0',
            '@tanstack/react-query': '^5.0.0',
          },
        },
        null,
        2,
      ),
    );

    return this.files;
  }
}

GeneratorRegistry.register('typescript', TypeScriptGenerator);
