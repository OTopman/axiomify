/**
 * Compiler Pipeline Orchestrator.
 *
 * Coordinates the execution of all compiler phases:
 * Ingest -> Normalize -> Analyze -> Optimize -> Transform -> Validate -> Output IR
 */
import type { IRCompilationResult, IRDiagnostic, IRSchema } from '../ir/types';
import { PluginRunner } from '../plugin/plugin';
import { Analyzer } from './analyzer';
import { Normalizer } from './normalizer';
import { Optimizer } from './optimizer';
import { Transformer } from './transformer';
import { Validator } from './validator';

export class CompilerPipeline {
  private normalizer = new Normalizer();
  private analyzer = new Analyzer();
  private optimizer = new Optimizer();
  private transformer = new Transformer();
  private validator = new Validator();

  /**
   * Get the pipeline's transformer to register custom transformers/plugins.
   */
  getTransformer(): Transformer {
    return this.transformer;
  }

  /**
   * Run the full compilation pipeline on a raw, ingested IR schema.
   */
  async compile(
    schema: IRSchema,
    initialDiagnostics: IRDiagnostic[] = [],
  ): Promise<IRCompilationResult> {
    const startTime = Date.now();
    const diagnostics = [...initialDiagnostics];

    // Plugin Hook: Before Compile
    await PluginRunner.runBeforeCompile(schema, diagnostics);

    // Phase 1: Normalize
    this.normalizer.normalize(schema, diagnostics);

    // Phase 2: Analyze
    this.analyzer.analyze(schema, diagnostics);

    // Phase 3: Optimize
    this.optimizer.optimize(schema, diagnostics);

    // Phase 4: Transform (User / plugin modifications)
    this.transformer.transform(schema, diagnostics);

    // Plugin Hook: After Compile
    await PluginRunner.runAfterCompile(schema, diagnostics);

    // Phase 5: Validate
    this.validator.validate(schema, diagnostics);

    const hasErrors = diagnostics.some((d) => d.severity === 'error');

    return {
      schema,
      diagnostics,
      hasErrors,
      durationMs: Date.now() - startTime,
    };
  }
}
