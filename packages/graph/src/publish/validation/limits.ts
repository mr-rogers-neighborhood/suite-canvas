/**
 * Owns the caps a publish enforces and the resolver that turns caller overrides and env
 * values into them, plus the byte counter the caps are measured with.
 */
/** Largest absolute coordinate a publish accepts on a board. */
export const MAX_PUBLISH_COORDINATE = 10_000_000;

/**
 * Caps a publish applies before it can be ok. A draft lives in a Loro doc that
 * any client can write directly, so these are checked on the values a plan
 * captures, not only where the UI writes through `WorkspaceDocument`.
 */
export interface PublishLimits {
  /** Text bytes one card may carry in its title and body together. */
  maxCardTextBytes: number;
  /** Bytes the projected draft being published may hold. */
  maxDraftBytes: number;
  /** Largest absolute coordinate, size or stacking order on a board. */
  maxCoordinate: number;
  /** Deepest rich text nesting, root included. */
  maxRichTextDepth: number;
  /** Bytes a section title may hold. */
  maxSectionTitleLength: number;
  /** Bytes an edge label may hold. */
  maxEdgeLabelLength: number;
}

export const DEFAULT_PUBLISH_LIMITS: PublishLimits = {
  maxCardTextBytes: 1024 * 1024,
  maxDraftBytes: 20 * 1024 * 1024,
  maxCoordinate: MAX_PUBLISH_COORDINATE,
  maxRichTextDepth: 64,
  maxSectionTitleLength: 1000,
  maxEdgeLabelLength: 500,
};

function positive(value: number | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

/** Environment overrides, so a deployment can tune the two byte caps. */
function envNumber(name: string): number | undefined {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
    ?.env;
  const raw = env?.[name];
  if (!raw) return undefined;
  return positive(Number(raw));
}

/** Merges explicit overrides over environment overrides over the defaults. */
export function resolvePublishLimits(overrides?: Partial<PublishLimits>): PublishLimits {
  return {
    maxCardTextBytes:
      positive(overrides?.maxCardTextBytes) ??
      envNumber("SUITE_PUBLISH_MAX_CARD_TEXT_BYTES") ??
      DEFAULT_PUBLISH_LIMITS.maxCardTextBytes,
    maxDraftBytes:
      positive(overrides?.maxDraftBytes) ??
      envNumber("SUITE_PUBLISH_MAX_DRAFT_BYTES") ??
      DEFAULT_PUBLISH_LIMITS.maxDraftBytes,
    maxCoordinate: positive(overrides?.maxCoordinate) ?? DEFAULT_PUBLISH_LIMITS.maxCoordinate,
    maxRichTextDepth:
      positive(overrides?.maxRichTextDepth) ?? DEFAULT_PUBLISH_LIMITS.maxRichTextDepth,
    maxSectionTitleLength:
      positive(overrides?.maxSectionTitleLength) ?? DEFAULT_PUBLISH_LIMITS.maxSectionTitleLength,
    maxEdgeLabelLength:
      positive(overrides?.maxEdgeLabelLength) ?? DEFAULT_PUBLISH_LIMITS.maxEdgeLabelLength,
  };
}

const encoder = new TextEncoder();

export function utf8ByteLength(text: string): number {
  return encoder.encode(text).length;
}
