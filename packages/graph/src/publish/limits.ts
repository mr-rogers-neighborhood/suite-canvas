/**
 * Owns the publish-limits seam: the `PublishLimits` type and the resolver that
 * turns caller overrides into the caps planning enforces.
 *
 * The caps themselves are defined and env-resolved in
 * `publish/validation/limits.ts`, beside the validators that read them, and this module only re-exports that
 * definition so every publish module imports limits from one place. It must
 * never invent a cap, re-derive a default or clamp a value: a limit that
 * disagrees with the validator is a limit that cannot be trusted.
 */

export type { PublishLimits } from "../publishValidation.js";
export { DEFAULT_PUBLISH_LIMITS, resolvePublishLimits } from "../publishValidation.js";
