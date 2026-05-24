import { Generator, type GeneratedFile } from '../../generator';
import { TypeGraph } from '../../../ir/type-graph';
import { DartTypeEmitter } from './type-emitter';
import { DartClientEmitter } from './client-emitter';
import { GeneratorRegistry } from '../../registry';

export class DartGenerator extends Generator {
  async generate(): Promise<GeneratedFile[]> {
    const graph = TypeGraph.fromSchema(this.schema);
    
    const typeEmitter = new DartTypeEmitter(this.schema, graph);
    this.addFile('lib/types.dart', typeEmitter.emitAll());

    const clientEmitter = new DartClientEmitter(this.schema, 'ApiClient');
    this.addFile('lib/client.dart', clientEmitter.emitAll());

    this.addFile('pubspec.yaml', `name: ${this.options.packageName}\nversion: ${this.options.version || '1.0.0'}\nenvironment:\n  sdk: '>=3.0.0 <4.0.0'\n\ndependencies:\n  http: ^1.1.0\n`);

    return this.files;
  }
}

GeneratorRegistry.register('dart', DartGenerator);
