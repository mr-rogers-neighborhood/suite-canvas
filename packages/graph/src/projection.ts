/**
 * The share projection in one public surface: what a board, a selection or a
 * card looks like to someone who was not given the workspace.
 *
 * `projectWorkspace` builds that view into a fresh doc; `applyProjection`
 * replays it into a live one. The implementation lives in `projection/`.
 */

export { applyProjection, PROJECTION_APPLY_ORIGIN } from "./projection/apply.js";
export type {
  ProjectionOptions,
  ProjectionReference,
  ProjectionResult,
  ShareScope,
} from "./projection/workspace.js";
export {
  PRIVATE_REFERENCE_TITLE,
  projectWorkspace,
  SHARE_BOARD_ID,
  SHARE_BOARD_NAME,
} from "./projection/workspace.js";
