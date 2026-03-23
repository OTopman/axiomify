export { z } from 'zod';
export * from './core/route';
export * from './core/types';

// Internal API for CLI execution
export { bootstrap as _internal_bootstrap } from './server/bootstrap';

// The config helper
import type { AxiomifyConfig } from './core/types';
export function defineConfig(config: AxiomifyConfig): AxiomifyConfig {
  return config;
}
