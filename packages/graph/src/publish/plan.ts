/**
 * Owns planning: `planPublish`, the per-kind planners comparing draft, baseline
 * and source, the `PublishPlan` types they produce, and the helpers that record
 * changes, conflicts and unsupported keys.
 *
 * Planning is the only place that validates and the only place that decides
 * what a difference means, and it must never write to any document: a plan is
 * pure and replayable. Apply reads only the captured values, so a check skipped
 * here becomes an unvalidated value replayed there.
 *
 * The implementation lives beside this file (`planModel`, `planGuards`,
 * `planCards`, `planLayout`, `planRun`); import from here.
 */

export { allowedFieldIds } from "./planGuards.js";
export type {
  CreatedCardSnapshot,
  PublishChange,
  PublishConflict,
  PublishFieldKind,
  PublishPlan,
  PublishPlanOptions,
  PublishScope,
  PublishValue,
} from "./planModel.js";
export { planPublish } from "./planRun.js";
