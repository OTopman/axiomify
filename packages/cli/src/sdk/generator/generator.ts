/**
 * Base Generator.
 *
 * Abstract class that all language-specific generators extend.
 * Provides the lifecycle hooks for generating an SDK from an IRSchema.
 */
import type { IRSchema } from '../ir/types';

export interface GeneratorOptions {
  packageName: string;
  outputDir: string;
  version?: string;
  runtime?: boolean; // Whether to emit runtime dependencies (mostly for TS)
}

export interface GeneratedFile {
  path: string;
  content: string;
}

export abstract class Generator {
  protected schema: IRSchema;
  protected options: GeneratorOptions;
  protected files: GeneratedFile[] = [];

  constructor(schema: IRSchema, options: GeneratorOptions) {
    this.schema = schema;
    this.options = options;
  }

  /**
   * The main entry point. Orchestrates the generation of all necessary files.
   * Generators should populate the `this.files` array.
   */
  abstract generate(): Promise<GeneratedFile[]>;

  /** Helper to add a file to the output. */
  protected addFile(path: string, content: string): void {
    this.files.push({ path, content });
  }
}
