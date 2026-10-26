/**
 * Account-level export and erase.
 *
 * The control plane owns the identity rows and nothing else: documents, share rows and
 * attachment bytes live on the relay, and the port for them is injected by the
 * deployment that can reach it. That split is why the erase reports per store instead
 * of returning one boolean.
 */

export { type AccountEraseDeps, eraseAccount } from "./erase.js";
export { type AccountExportDeps, accountExport, accountExportFileName } from "./export.js";
export {
  type MemoryAccountStore,
  memoryAccountStore,
  type WorkspaceEraseFailure,
} from "./memory.js";
export { postgresAccountStore } from "./postgres.js";
export { type AccountStore, relayDeleteCommand, type WorkspaceDataStore } from "./store.js";
export {
  type AccountErasureReport,
  type AccountExport,
  type AccountOrganization,
  type AccountProfile,
  type AccountShare,
  type AccountSnapshot,
  type AccountWorkspace,
  type ErasureCounts,
  type ErasurePlan,
  type ErasureStatus,
  type ErasureStore,
  type ErasureStoreReport,
  type ExportedOrganization,
  type ExportedWorkspace,
  erasureStores,
  type OrganizationErasure,
  type WorkspaceDataErasure,
  type WorkspaceErasure,
} from "./types.js";
