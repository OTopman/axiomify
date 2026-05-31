/**
 * Generator Registry.
 *
 * Maintains a registry of available language targets. Allows plugins
 * to register custom generator backends.
 */
import type { Generator, GeneratorOptions } from './generator';
import type { IRSchema } from '../ir/types';

export type GeneratorConstructor = new (
  schema: IRSchema,
  options: GeneratorOptions,
) => Generator;

export class GeneratorRegistry {
  private static generators = new Map<string, GeneratorConstructor>();

  /** Register a new language target generator. */
  static register(target: string, generatorClass: GeneratorConstructor): void {
    this.generators.set(target.toLowerCase(), generatorClass);
  }

  /** Get a registered generator by target name. */
  static get(target: string): GeneratorConstructor | undefined {
    return this.generators.get(target.toLowerCase());
  }

  /** Get all registered target names. */
  static targets(): string[] {
    return Array.from(this.generators.keys());
  }
}
