import { Generator, type GeneratedFile } from '../../generator';
import { TypeGraph } from '../../../ir/type-graph';
import { KotlinTypeEmitter } from './type-emitter';
import { KotlinClientEmitter } from './client-emitter';
import { GeneratorRegistry } from '../../registry';

export class KotlinGenerator extends Generator {
  async generate(): Promise<GeneratedFile[]> {
    const graph = TypeGraph.fromSchema(this.schema);
    const pkgName =
      this.options.packageName.replace(/[^a-zA-Z0-9_.]/g, '').toLowerCase() ||
      'com.axiomify.sdk';

    const typeEmitter = new KotlinTypeEmitter(this.schema, graph, pkgName);
    this.addFile('src/main/kotlin/Types.kt', typeEmitter.emitAll());

    const clientEmitter = new KotlinClientEmitter(
      this.schema,
      pkgName,
      'ApiClient',
    );
    this.addFile('src/main/kotlin/Client.kt', clientEmitter.emitAll());

    this.addFile(
      'build.gradle.kts',
      `plugins {
    kotlin("jvm") version "1.9.0"
    kotlin("plugin.serialization") version "1.9.0"
}

repositories {
    mavenCentral()
}

dependencies {
    implementation("com.squareup.okhttp3:okhttp:4.11.0")
    implementation("com.squareup.retrofit2:retrofit:2.9.0")
    implementation("com.jakewharton.retrofit:retrofit2-kotlinx-serialization-converter:1.0.0")
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.6.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-core:1.7.3")
}
`,
    );

    return this.files;
  }
}

GeneratorRegistry.register('kotlin', KotlinGenerator);
