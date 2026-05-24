/**
 * Compiler Pipeline Orchestrator.
 *
 * Coordinates the execution of all compiler phases:
 * Ingest -> Normalize -> Analyze -> Optimize -> Validate -> Output IR
 */
import type { IRSchema, IRDiagnostic, IRCompilationResult } from '../ir/types';
import { Normalizer } from './normalizer';
import { Analyzer } from './analyzer';
import { Optimizer } from './optimizer';
import { Validator } from './validator';

export class CompilerPipeline {
  private normalizer = new Normalizer();
  private analyzer = new Analyzer();
  private optimizer = new Optimizer();
  private validator = new Validator();

  /**
   * Run the full compilation pipeline on a raw, ingested IR schema.
   */
  compile(schema: IRSchema, initialDiagnostics: IRDiagnostic[] = []): IRCompilationResult {
    const startTime = Date.now();
    const diagnostics = [...initialDiagnostics];

    // Phase 1: Normalize
    this.normalizer.normalize(schema, diagnostics);

    // Phase 2: Analyze
    this.analyzer.analyze(schema, diagnostics);

    // Phase 3: Optimize
    this.optimizer.optimize(schema, diagnostics);

    // Phase 4: Validate
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
