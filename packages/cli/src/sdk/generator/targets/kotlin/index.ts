import { Generator, type GeneratedFile } from '../../generator';
import { TypeGraph } from '../../../ir/type-graph';
import { KotlinTypeEmitter } from './type-emitter';
import { KotlinClientEmitter } from './client-emitter';
import { GeneratorRegistry } from '../../registry';

export class KotlinGenerator extends Generator {
  async generate(): Promise<GeneratedFile[]> {
    const graph = TypeGraph.fromSchema(this.schema);
    const pkgName = this.options.packageName.replace(/[^a-zA-Z0-9_.]/g, '').toLowerCase() || 'com.axiomify.sdk';
    
    const typeEmitter = new KotlinTypeEmitter(this.schema, graph, pkgName);
    this.addFile('src/main/kotlin/Types.kt', typeEmitter.emitAll());

    const clientEmitter = new KotlinClientEmitter(this.schema, pkgName, 'ApiClient');
    this.addFile('src/main/kotlin/Client.kt', clientEmitter.emitAll());

    this.addFile('build.gradle.kts', `plugins {\n    kotlin("jvm") version "1.9.0"\n}\n\nrepositories {\n    mavenCentral()\n}\n\ndependencies {\n    // Add okhttp/gson dependencies here in a real implementation\n}`);

    return this.files;
  }
}

GeneratorRegistry.register('kotlin', KotlinGenerator);
