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

    this.addFile('pubspec.yaml', `name: ${this.options.packageName}
version: ${this.options.version || '1.0.0'}
environment:
  sdk: '>=3.0.0 <4.0.0'

dependencies:
  dio: ^5.3.0
  freezed_annotation: ^2.4.1
  riverpod: ^2.4.0
  json_annotation: ^4.8.1

dev_dependencies:
  build_runner: ^2.4.6
  freezed: ^2.4.5
  json_serializable: ^6.7.1
`);

    return this.files;
  }
}

GeneratorRegistry.register('dart', DartGenerator);
