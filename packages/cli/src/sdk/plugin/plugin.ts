/**
 * Plugin System.
 * Defines plugin interfaces, loads and runs third-party plugins in a sandboxed/controlled fashion.
 */
import type { IRDiagnostic, IRSchema } from '../ir/types';

export interface AxiomifySdkPlugin {
  name: string;
  version: string;
  onBeforeCompile?: (
    schema: IRSchema,
    diagnostics: IRDiagnostic[],
  ) => void | Promise<void>;
  onAfterCompile?: (
    schema: IRSchema,
    diagnostics: IRDiagnostic[],
  ) => void | Promise<void>;
  onBeforeGenerate?: (target: string, schema: IRSchema) => void | Promise<void>;
}

export class PluginRegistry {
  private static plugins: AxiomifySdkPlugin[] = [];

  static register(plugin: AxiomifySdkPlugin): void {
    if (this.plugins.some((p) => p.name === plugin.name)) {
      throw new Error(`Plugin "${plugin.name}" is already registered.`);
    }
    this.plugins.push(plugin);
  }

  static getPlugins(): AxiomifySdkPlugin[] {
    return this.plugins;
  }

  static clear(): void {
    this.plugins = [];
  }
}

export class PluginRunner {
  static async runBeforeCompile(
    schema: IRSchema,
    diagnostics: IRDiagnostic[],
  ): Promise<void> {
    for (const plugin of PluginRegistry.getPlugins()) {
      if (plugin.onBeforeCompile) {
        try {
          await plugin.onBeforeCompile(schema, diagnostics);
        } catch (err: any) {
          diagnostics.push({
            severity: 'error',
            code: 'PLUGIN_ERROR',
            message: `Plugin "${plugin.name}" onBeforeCompile failed: ${err.message || err}`,
          });
        }
      }
    }
  }

  static async runAfterCompile(
    schema: IRSchema,
    diagnostics: IRDiagnostic[],
  ): Promise<void> {
    for (const plugin of PluginRegistry.getPlugins()) {
      if (plugin.onAfterCompile) {
        try {
          await plugin.onAfterCompile(schema, diagnostics);
        } catch (err: any) {
          diagnostics.push({
            severity: 'error',
            code: 'PLUGIN_ERROR',
            message: `Plugin "${plugin.name}" onAfterCompile failed: ${err.message || err}`,
          });
        }
      }
    }
  }

  static async runBeforeGenerate(
    target: string,
    schema: IRSchema,
  ): Promise<void> {
    for (const plugin of PluginRegistry.getPlugins()) {
      if (plugin.onBeforeGenerate) {
        try {
          await plugin.onBeforeGenerate(target, schema);
        } catch (err) {
          console.error(
            `Plugin "${plugin.name}" onBeforeGenerate failed:`,
            err,
          );
        }
      }
    }
  }
}
