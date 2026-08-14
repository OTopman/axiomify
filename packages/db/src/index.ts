/**
 * @axiomify/db — client-agnostic database integration for Axiomify.
 *
 * Register any database client (Prisma, Drizzle, pg, mysql2, better-sqlite3
 * or your own) through DI, with duck-typed lifecycle defaults, health checks,
 * graceful shutdown, transactions and a stable CLI manifest contract.
 */
export { detectClientKind, deriveBehavior } from './detect';
export type { ClientKind, DerivedBehavior } from './detect';

export {
  createDatabaseModule,
  HEALTH_CHECK_TIMEOUT_MS,
  withTimeout,
} from './module';
export type { DatabaseHandle, DatabaseModuleOptions } from './module';

export { dbHealthChecks, dbShutdown } from './health';

export { withTransaction } from './transaction';

export { defineDbConfig, loadDbConfig, DB_CONFIG_FILES } from './config';
export type { DbCommand, DbConfig, LoadedDbConfig } from './config';
