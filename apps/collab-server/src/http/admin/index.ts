/**
 * The operator API's public surface. `/metrics` and `/api/admin/*` are one
 * feature — the router, its dependency shape and the bounds it enforces — so
 * the folder exposes exactly those and nothing from the resource modules.
 */

export type { AdminRoomRow } from "./deps.js";
export {
  type AdminAuthKinds,
  type AdminDatabasePaths,
  type AdminRequestDeps,
  MAX_ADMIN_PAGE,
} from "./deps.js";
export { FIXTURE_CAPS } from "./fixtures.js";
export { ADMIN_API_PATH, handleAdminRequest, METRICS_PATH } from "./router.js";
