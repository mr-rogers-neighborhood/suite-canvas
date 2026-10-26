/**
 * The publish validators, in one public surface: the caps a publish enforces,
 * the rich-text allowlist and tree checks, and the placement, section and edge
 * issues a plan records instead of throwing.
 *
 * The implementation lives in `publish/validation/`; import from here so the
 * caps, the allowlist and the messages stay one seam.
 */

export type { EdgeValidationContext } from "./publish/validation/issues.js";
export { edgeIssue, placementIssue, sectionIssue } from "./publish/validation/issues.js";
export type { PublishLimits } from "./publish/validation/limits.js";
export {
  DEFAULT_PUBLISH_LIMITS,
  MAX_PUBLISH_COORDINATE,
  resolvePublishLimits,
  utf8ByteLength,
} from "./publish/validation/limits.js";
export { richTextBytes, validateRichTextTree } from "./publish/validation/richText.js";
export {
  RICH_TEXT_MARK_NAMES,
  RICH_TEXT_NODE_ATTRIBUTE_NAMES,
  RICH_TEXT_NODE_NAMES,
} from "./publish/validation/richTextSchema.js";
