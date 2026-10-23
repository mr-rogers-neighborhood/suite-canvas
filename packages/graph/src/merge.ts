/**
 * Public surface of the share-publish system. The implementation lives under
 * `publish/`; this module only re-exports it, so every existing import keeps
 * working. It must never hold logic again: behaviour belongs to the owning
 * module, and a function added here would hide which module owns it.
 */

export { applyPublish, PUBLISH_ORIGIN } from "./publish/apply.js";
export { type BlockTarget, type BodyBlock, readBodyBlocks } from "./publish/blocks.js";
export {
  type CreatedCardSnapshot,
  type PublishChange,
  type PublishConflict,
  type PublishFieldKind,
  type PublishPlan,
  type PublishPlanOptions,
  type PublishScope,
  type PublishValue,
  planPublish,
} from "./publish/plan.js";
export type {
  PlacementSnapshot,
  RichTextSnapshot,
  RichTextTextSnapshot,
} from "./publish/snapshot.js";
