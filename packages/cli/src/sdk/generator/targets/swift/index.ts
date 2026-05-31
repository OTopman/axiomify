import { Generator, type GeneratedFile } from '../../generator';
import { TypeGraph } from '../../../ir/type-graph';
import { SwiftTypeEmitter } from './type-emitter';
import { SwiftClientEmitter } from './client-emitter';
import { GeneratorRegistry } from '../../registry';

export class SwiftGenerator extends Generator {
  async generate(): Promise<GeneratedFile[]> {
    const graph = TypeGraph.fromSchema(this.schema);

    const typeEmitter = new SwiftTypeEmitter(this.schema, graph);
    this.addFile('Types.swift', typeEmitter.emitAll());

    const clientEmitter = new SwiftClientEmitter(this.schema, 'ApiClient');
    this.addFile('Client.swift', clientEmitter.emitAll());

    this.addFile(
      'Package.swift',
      `// swift-tools-version:5.5\nimport PackageDescription\n\nlet package = Package(\n    name: "${this.options.packageName}",\n    products: [\n        .library(name: "${this.options.packageName}", targets: ["${this.options.packageName}"]),\n    ],\n    targets: [\n        .target(name: "${this.options.packageName}", path: ".")\n    ]\n)`,
    );

    return this.files;
  }
}

GeneratorRegistry.register('swift', SwiftGenerator);
