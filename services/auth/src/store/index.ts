/**
 * Store: the ports the control plane reads through, and the two implementations of
 * them — `memoryControlPlane` for tests and local development, `postgresRepositories`
 * for a deployment.
 *
 * This is the surface behind the package's `repository` export, because a caller that
 * needs "the store" needs all three ports at once: they are built from one pool and
 * must agree about the same rows.
 */
export type { LicenceStore, MembershipReader } from "../licensing/licences.js";
export type { WorkspaceRepository } from "../organizations/workspaces.js";
export { type MemoryControlPlane, memoryControlPlane } from "./memory.js";
export {
  checksumOf,
  MIGRATIONS_DIRECTORY,
  MigrationChecksumError,
  type MigrationConnection,
  type MigrationFile,
  type MigrationStatus,
  type MigrationTarget,
  migrate,
  migrateAtBoot,
  migrationsEnabled,
  planMigrations,
  status as migrationStatus,
} from "./migrate.js";
export {
  databaseUrlProblem,
  kyselyDatabase,
  type PostgresDatabase,
  type PostgresOptions,
  poolQueryable,
  postgresDatabase,
  type Queryable,
  type QueryConnection,
} from "./postgres.js";
export {
  postgresLicences,
  postgresMemberships,
  postgresRepositories,
  postgresWorkspaces,
} from "./postgresRepositories.js";
