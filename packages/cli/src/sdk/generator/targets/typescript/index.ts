import { Generator, type GeneratedFile } from '../../generator';
import { TypeGraph } from '../../../ir/type-graph';
import { TsTypeEmitter } from './type-emitter';
import { TsClientEmitter } from './client-emitter';
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

    // 3. Generate index.ts
    this.addFile('index.ts', `export * from './types';\nexport * from './client';\n`);

    // 4. Generate package.json
    this.addFile('package.json', JSON.stringify({
      name: this.options.packageName,
      version: this.options.version || '1.0.0',
      main: 'index.ts', // In a real build, we'd compile this or set up tsup
      dependencies: this.options.runtime ? {
        '@axiomify/sdk-runtime': 'latest'
      } : {}
    }, null, 2));

    return this.files;
  }
}

GeneratorRegistry.register('typescript', TypeScriptGenerator);

