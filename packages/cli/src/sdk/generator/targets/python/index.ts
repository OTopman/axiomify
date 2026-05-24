import { Generator, type GeneratedFile } from '../../generator';
import { TypeGraph } from '../../../ir/type-graph';
import { PythonTypeEmitter } from './type-emitter';
import { PythonClientEmitter } from './client-emitter';
import { GeneratorRegistry } from '../../registry';

export class PythonGenerator extends Generator {
  async generate(): Promise<GeneratedFile[]> {
    const graph = TypeGraph.fromSchema(this.schema);
    
    const typeEmitter = new PythonTypeEmitter(this.schema, graph);
    this.addFile('types.py', typeEmitter.emitAll());

    const clientEmitter = new PythonClientEmitter(this.schema, 'ApiClient');
    this.addFile('client.py', clientEmitter.emitAll());

    this.addFile('__init__.py', `from .types import *\nfrom .client import ApiClient\n`);

    return this.files;
  }
}

GeneratorRegistry.register('python', PythonGenerator);
