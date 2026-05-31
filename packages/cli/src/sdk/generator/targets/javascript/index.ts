import { TypeGraph } from '../../../ir/type-graph';
import { Generator, type GeneratedFile } from '../../generator';
import { GeneratorRegistry } from '../../registry';
import { TsTypeEmitter } from '../typescript/type-emitter';
import { JsClientEmitter } from './client-emitter';

export class JavaScriptGenerator extends Generator {
  async generate(): Promise<GeneratedFile[]> {
    const graph = TypeGraph.fromSchema(this.schema);

    // 1. Generate types.d.ts (JSDoc typed definition file)
    const typeEmitter = new TsTypeEmitter(this.schema, graph);
    this.addFile('types.d.ts', typeEmitter.emitAll());

    // 2. Generate client.js (JSDoc-annotated JavaScript client)
    const clientEmitter = new JsClientEmitter(this.schema, 'ApiClient');
    this.addFile('client.js', clientEmitter.emitAll());

    // 3. Generate index.js
    this.addFile(
      'index.js',
      `const { ApiClient } = require('./client');\nmodule.exports = { ApiClient };\n`,
    );

    // 4. Generate index.d.ts
    this.addFile(
      'index.d.ts',
      `export * from './types';\nexport { ApiClient } from './client';\n`,
    );

    // 5. Generate package.json
    this.addFile(
      'package.json',
      JSON.stringify(
        {
          name: this.options.packageName,
          version: this.options.version || '1.0.0',
          main: 'index.js',
          types: 'index.d.ts',
          dependencies: {},
        },
        null,
        2,
      ),
    );

    return this.files;
  }
}

GeneratorRegistry.register('javascript', JavaScriptGenerator);
