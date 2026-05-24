import { Generator, type GeneratedFile } from '../../generator';
import { TypeGraph } from '../../../ir/type-graph';
import { GoTypeEmitter } from './type-emitter';
import { GoClientEmitter } from './client-emitter';
import { GeneratorRegistry } from '../../registry';

export class GoGenerator extends Generator {
  async generate(): Promise<GeneratedFile[]> {
    const graph = TypeGraph.fromSchema(this.schema);
    const pkgName = this.options.packageName.replace(/[^a-zA-Z0-9]/g, '');

    const typeEmitter = new GoTypeEmitter(this.schema, graph, pkgName);
    this.addFile('types.go', typeEmitter.emitAll());

    const clientEmitter = new GoClientEmitter(this.schema, pkgName);
    this.addFile('client.go', clientEmitter.emitAll());

    this.addFile('go.mod', `module ${this.options.packageName}\n\ngo 1.20\n`);

    return this.files;
  }
}

GeneratorRegistry.register('go', GoGenerator);
