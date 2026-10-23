/**
 * Owns the plan record: the two primitives that write into a `PublishPlan`
 * while it is being planned.
 *
 * They live alone, importing only types, so `plan.ts` and `creations.ts` can
 * both use them without importing each other. Before this module existed the
 * two files imported each other's functions, which worked only because every
 * call happened after module initialisation — a cycle that any future
 * top-level use would have turned into a crash. It must never gain behaviour:
 * deciding *what* to record belongs to planning and to creations, this module
 * only appends.
 */

import type { PublishChange, PublishPlan, PublishValue } from "./plan.js";

/** Records a change together with the exact draft value it will replay. */
export function record(plan: PublishPlan, change: PublishChange, value: PublishValue): void {
  plan.changes.push(change);
  plan.values[change.key] = value;
}

/**
 * Records a key outside what an editor share may publish. One unsupported
 * entry rejects the whole publish, so a caller must add it the moment it knows
 * the change cannot be applied rather than at the end.
 */
export function addUnsupported(
  plan: PublishPlan,
  key: string,
  message: string,
  label?: string,
): void {
  plan.unsupported.push({ key, kind: "unsupported", message, ...(label ? { label } : {}) });
}
