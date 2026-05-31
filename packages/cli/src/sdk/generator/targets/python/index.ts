import { Generator, type GeneratedFile } from '../../generator';
import { TypeGraph } from '../../../ir/type-graph';
import { PythonTypeEmitter } from './type-emitter';
import { PythonClientEmitter } from './client-emitter';
import { GeneratorRegistry } from '../../registry';

export class PythonGenerator extends Generator {
  async generate(): Promise<GeneratedFile[]> {
    const graph = TypeGraph.fromSchema(this.schema);

    // 1. Generate types.py
    const typeEmitter = new PythonTypeEmitter(this.schema, graph);
    this.addFile('types.py', typeEmitter.emitAll());

    // 2. Generate client.py
    const clientEmitter = new PythonClientEmitter(this.schema, 'ApiClient');
    this.addFile('client.py', clientEmitter.emitAll());

    // 3. Generate __init__.py
    this.addFile(
      '__init__.py',
      `from .types import *\nfrom .client import ApiClient\n`,
    );

    // 4. Generate setup.py
    this.addFile(
      'setup.py',
      `from setuptools import setup, find_packages

setup(
    name="${this.options.packageName}",
    version="${this.options.version || '1.0.0'}",
    packages=find_packages(),
    install_requires=[
        "httpx>=0.24.0",
        "pydantic>=2.0.0"
    ],
    python_requires=">=3.8",
)
`,
    );

    return this.files;
  }
}

GeneratorRegistry.register('python', PythonGenerator);
