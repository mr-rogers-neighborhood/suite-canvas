/**
 * Stable error codes (i18n scaffolding).
 *
 * A code ships before its sentence. A surface raises a code, the catalogue turns
 * it into words, and a reworded or translated catalogue changes the words without
 * touching the code that raised the failure. A log line, a bug report and a test
 * all name the same string.
 *
 * The shape is `domain.subject.reason`, lowercase: `annotation.range.unanchored`
 * says which surface, which thing and which failure without opening the module.
 *
 * Adding a code is additive. Append it here and the catalogue fails to compile
 * until it has a message, so a code cannot ship mute.
 */
export const errorCodes = [
  "annotation.range.stale",
  "annotation.range.unanchored",
  "annotation.record.incomplete",
  "annotation.source.missing",
  "blueprint.install.empty",
  "blueprint.install.unsupported",
  "peek.target.missing",
] as const;

export type ErrorCode = (typeof errorCodes)[number];

/** Narrowing helper: a boundary payload may carry any string where a code is expected. */
export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === "string" && (errorCodes as readonly string[]).includes(value);
}
