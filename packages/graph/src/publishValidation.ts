import type { PlacementSnapshot, RichTextSnapshot, RichTextTextSnapshot } from "./merge.js";
import type { GraphEdge, Section } from "./schema.js";
import { edgeKinds, edgePaths, sectionColors } from "./schema.js";

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

// ------------------------------------------------------------- rich text

/**
 * Node names the editor schema produces; anything else is not publishable.
 *
 * This list and the one below are checked against the real Tiptap schema by
 * `apps/canvas/src/editor/editorSchemaContract.test.ts`. Adding a node, mark or
 * node attribute to the editor requires updating them here as well, or the
 * contract test fails.
 */
export const RICH_TEXT_NODE_NAMES = [
  "doc",
  "paragraph",
  "heading",
  "bulletList",
  "orderedList",
  "listItem",
  "blockquote",
  "codeBlock",
  "horizontalRule",
  "hardBreak",
  "text",
  "mention",
  "propertyBlock",
  "attachment",
] as const;

/** Marks the editor schema produces. */
export const RICH_TEXT_MARK_NAMES = [
  "bold",
  "italic",
  "strike",
  "code",
  "link",
  "underline",
] as const;

/** Attributes each node may carry; the editor itself writes no others. */
export const RICH_TEXT_NODE_ATTRIBUTE_NAMES = {
  doc: [],
  paragraph: [],
  heading: ["level"],
  bulletList: [],
  orderedList: ["start", "type"],
  listItem: [],
  blockquote: [],
  codeBlock: ["language"],
  horizontalRule: [],
  hardBreak: [],
  text: [],
  mention: ["cardId", "display", "fieldId"],
  propertyBlock: ["fieldId", "display"],
  // Metadata only: the pixels are bytes beside the document, never in it.
  attachment: ["id", "mime", "width", "height", "name", "bytes"],
} as const satisfies Record<string, readonly string[]>;

const ALLOWED_NODES = new Set<string>(RICH_TEXT_NODE_NAMES);
const ALLOWED_MARKS = new Set<string>(RICH_TEXT_MARK_NAMES);
const NODE_FIELDS = new Set(["nodeName", "attributes", "children"]);
const NODE_ATTRIBUTES: Record<string, ReadonlySet<string>> = Object.fromEntries(
  Object.entries(RICH_TEXT_NODE_ATTRIBUTE_NAMES).map(([nodeName, attributes]) => [
    nodeName,
    new Set(attributes),
  ]),
);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isTextSnapshot(value: unknown): value is RichTextTextSnapshot {
  return isRecord(value) && "$text" in value;
}

function clip(value: string): string {
  return value.length > 120 ? `${value.slice(0, 117)}...` : value;
}

function linkHref(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (isRecord(value) && !isTextSnapshot(value) && typeof value.href === "string") {
    // A mark attribute bundle may carry nulls for unset link options.
    if (Object.values(value).some((entry) => entry !== null && typeof entry === "object")) {
      return null;
    }
    return value.href;
  }
  return null;
}

/** Only web and mail links survive a publish; `javascript:` and friends do not. */
function isAllowedLink(href: string): boolean {
  for (const character of href) {
    if (character.charCodeAt(0) <= 0x20) return false;
  }
  if (!/^(?:https?|mailto):/i.test(href)) return false;
  try {
    new URL(href);
    return true;
  } catch {
    return false;
  }
}

function validateMarks(attributes: unknown, path: string): string | null {
  if (!isRecord(attributes) || isTextSnapshot(attributes)) {
    return `${path} has mark attributes that are not a plain object`;
  }
  for (const [name, value] of Object.entries(attributes)) {
    if (!ALLOWED_MARKS.has(name)) return `${path} has an unknown mark "${clip(name)}"`;
    if (name === "link") {
      const href = linkHref(value);
      if (href === null) return `${path} has a link mark without an href`;
      if (!isAllowedLink(href)) {
        return `${path} has a link that is not http, https or mailto: "${clip(href)}"`;
      }
      continue;
    }
    if (typeof value !== "boolean") return `${path} mark "${name}" is not a boolean`;
  }
  return null;
}

function validateTextDelta(delta: unknown, limits: PublishLimits, path: string): string | null {
  if (!Array.isArray(delta)) return `${path} has no text delta`;
  let bytes = 0;
  for (const [index, op] of delta.entries()) {
    if (!isRecord(op) || isTextSnapshot(op)) {
      return `${path}.delta[${index}] is not a text operation`;
    }
    for (const key of Object.keys(op)) {
      if (key !== "insert" && key !== "attributes") {
        return `${path}.delta[${index}] has an unknown field "${clip(key)}"`;
      }
    }
    const insert = op.insert;
    if (typeof insert !== "string") {
      return `${path}.delta[${index}] inserts a value that is not text`;
    }
    bytes += utf8ByteLength(insert);
    const attributes = op.attributes;
    if (attributes !== undefined) {
      const issue = validateMarks(attributes, `${path}.delta[${index}]`);
      if (issue) return issue;
    }
  }
  if (bytes > limits.maxCardTextBytes) {
    return `${path} holds ${bytes} bytes of text; the publish limit is ${limits.maxCardTextBytes}`;
  }
  return null;
}

/**
 * The attachment node's attributes are metadata for bytes held elsewhere, so a
 * publish checks their shape: an id the relay could have issued, a type it
 * serves, sizes that are whole numbers, and a name short enough to be alt text.
 * Anything else would project a node no reader could ever resolve.
 */
const ATTACHMENT_ID = /^[0-9a-f]{32}$/u;
const ATTACHMENT_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/avif",
]);
const ATTACHMENT_MAX_NAME_BYTES = 200;

function validateAttachmentAttribute(key: string, value: string | number | boolean): string | null {
  if (key === "id") {
    return typeof value === "string" && ATTACHMENT_ID.test(value)
      ? null
      : `is not an attachment id ("${clip(String(value))}")`;
  }
  if (key === "mime") {
    return typeof value === "string" && ATTACHMENT_MIME_TYPES.has(value)
      ? null
      : `is not an image type the relay serves ("${clip(String(value))}")`;
  }
  if (key === "width" || key === "height" || key === "bytes") {
    return typeof value === "number" && Number.isInteger(value) && value >= 0
      ? null
      : "is not a non-negative whole number";
  }
  if (key === "name") {
    return typeof value === "string" && utf8ByteLength(value) <= ATTACHMENT_MAX_NAME_BYTES
      ? null
      : `is longer than ${ATTACHMENT_MAX_NAME_BYTES} bytes`;
  }
  return null;
}

function validateAttributes(nodeName: string, attributes: unknown, path: string): string | null {
  if (!isRecord(attributes) || isTextSnapshot(attributes)) {
    return `${path}.attributes is not a plain object`;
  }
  const allowed = NODE_ATTRIBUTES[nodeName] ?? new Set<string>();
  for (const [key, value] of Object.entries(attributes)) {
    if (!allowed.has(key)) return `${path} has an unknown attribute "${clip(key)}"`;
    if (value === null) continue;
    const ok =
      typeof value === "string"
        ? true
        : typeof value === "boolean"
          ? true
          : typeof value === "number" && Number.isFinite(value);
    if (!ok) return `${path}.${key} is not a plain value`;
    if (nodeName === "attachment") {
      const issue = validateAttachmentAttribute(key, value as string | number | boolean);
      if (issue !== null) return `${path}.${key} ${issue}`;
    }
  }
  return null;
}

function validateNode(
  value: unknown,
  depth: number,
  limits: PublishLimits,
  path: string,
): string | null {
  if (depth > limits.maxRichTextDepth) {
    return `${path} nests deeper than ${limits.maxRichTextDepth} levels`;
  }
  if (!isRecord(value) || isTextSnapshot(value)) return `${path} is not a rich text node`;
  for (const key of Object.keys(value)) {
    if (!NODE_FIELDS.has(key)) return `${path} has an unknown field "${clip(key)}"`;
  }
  const nodeName = value.nodeName;
  if (typeof nodeName !== "string" || !ALLOWED_NODES.has(nodeName)) {
    return `${path} has an unknown node name "${clip(String(nodeName))}"`;
  }
  const attributes = value.attributes;
  if (attributes !== undefined) {
    const issue = validateAttributes(nodeName, attributes, path);
    if (issue) return issue;
  }
  const children = value.children;
  if (children === undefined) return null;
  if (!Array.isArray(children)) return `${path}.children is not a list`;
  for (const [index, child] of children.entries()) {
    const childPath = `${path}.children[${index}]`;
    if (isTextSnapshot(child)) {
      const issue = validateTextDelta(child.$text, limits, childPath);
      if (issue) return issue;
      continue;
    }
    if (!isRecord(child)) return `${childPath} is not a rich text node`;
    const issue = validateNode(child, depth + 1, limits, childPath);
    if (issue) return issue;
  }
  return null;
}

/**
 * Checks a captured rich text tree against the editor schema in plain JSON.
 * Returns a readable reason for the first problem, or `null` when publishable.
 */
export function validateRichTextTree(
  tree: RichTextSnapshot,
  limits: PublishLimits = DEFAULT_PUBLISH_LIMITS,
): string | null {
  if (tree === null) return null;
  if (!isRecord(tree) || isTextSnapshot(tree)) return validateNode(tree, 1, limits, "richText");
  // A root map written without a name is still the document node; older bodies
  // and direct CRDT writes create it that way.
  if (tree.nodeName === undefined) {
    return validateNode({ ...tree, nodeName: "doc" }, 1, limits, "richText");
  }
  return validateNode(tree, 1, limits, "richText");
}

function deltaBytes(delta: unknown): number {
  if (!Array.isArray(delta)) return 0;
  let bytes = 0;
  for (const op of delta) {
    if (!isRecord(op)) continue;
    const insert = op.insert;
    if (typeof insert === "string") bytes += utf8ByteLength(insert);
    const attributes = op.attributes;
    if (isRecord(attributes)) {
      for (const value of Object.values(attributes)) {
        if (typeof value === "string") bytes += utf8ByteLength(value);
        else if (isRecord(value)) {
          for (const nested of Object.values(value)) {
            if (typeof nested === "string") bytes += utf8ByteLength(nested);
          }
        }
      }
    }
  }
  return bytes;
}

/** Bytes a captured rich text tree holds, text and string attributes included. */
export function richTextBytes(tree: RichTextSnapshot): number {
  if (tree === null || typeof tree === "number" || typeof tree === "boolean") return 0;
  if (typeof tree === "string") return utf8ByteLength(tree);
  if (Array.isArray(tree)) {
    let bytes = 0;
    for (const child of tree) bytes += richTextBytes(child);
    return bytes;
  }
  if (isTextSnapshot(tree)) return deltaBytes(tree.$text);
  let bytes = 0;
  const attributes = tree.attributes;
  if (isRecord(attributes)) {
    for (const value of Object.values(attributes)) {
      if (typeof value === "string") bytes += utf8ByteLength(value);
    }
  }
  const children = tree.children;
  if (Array.isArray(children)) {
    for (const child of children) bytes += richTextBytes(child);
  }
  return bytes;
}

// -------------------------------------------------------------- geometry

function withinBounds(value: number, max: number): boolean {
  return typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= max;
}

/** Why a draft placement cannot be published, or `null`. */
export function placementIssue(
  placement: PlacementSnapshot,
  limits: PublishLimits = DEFAULT_PUBLISH_LIMITS,
): string | null {
  const max = limits.maxCoordinate;
  if (!withinBounds(placement.x, max) || !withinBounds(placement.y, max)) {
    return `Card ${placement.cardId} is placed outside ±${max}`;
  }
  if (!withinBounds(placement.z, max)) {
    return `Card ${placement.cardId} has a stacking order outside ±${max}`;
  }
  const sizes = [
    ["width", placement.width],
    ["height", placement.height],
  ] as const;
  for (const [name, value] of sizes) {
    if (value === undefined) continue;
    if (!withinBounds(value, max) || value <= 0) {
      return `Card ${placement.cardId} has an invalid ${name}`;
    }
  }
  return null;
}

/** Why a draft section cannot be published, or `null`. */
export function sectionIssue(
  section: Section,
  limits: PublishLimits = DEFAULT_PUBLISH_LIMITS,
): string | null {
  if (utf8ByteLength(section.title) > limits.maxSectionTitleLength) {
    return `Section ${section.id} has a title longer than ${limits.maxSectionTitleLength} bytes`;
  }
  if (section.color !== undefined && !sectionColors.includes(section.color)) {
    return `Section ${section.id} has an unknown color`;
  }
  const max = limits.maxCoordinate;
  if (!withinBounds(section.x, max) || !withinBounds(section.y, max)) {
    return `Section ${section.id} is placed outside ±${max}`;
  }
  if (!withinBounds(section.z, max)) {
    return `Section ${section.id} has a stacking order outside ±${max}`;
  }
  if (!withinBounds(section.width, max) || section.width <= 0) {
    return `Section ${section.id} has an invalid width`;
  }
  if (!withinBounds(section.height, max) || section.height <= 0) {
    return `Section ${section.id} has an invalid height`;
  }
  return null;
}

export interface EdgeValidationContext {
  /** Whether a card an edge points at still exists in the publish target. */
  isCardLive?: ((cardId: string) => boolean) | undefined;
}

/** Why a draft edge cannot be published, or `null`. */
export function edgeIssue(
  edge: GraphEdge,
  limits: PublishLimits = DEFAULT_PUBLISH_LIMITS,
  context: EdgeValidationContext = {},
): string | null {
  if (edge.label !== undefined && utf8ByteLength(edge.label) > limits.maxEdgeLabelLength) {
    return `Edge ${edge.id} has a label longer than ${limits.maxEdgeLabelLength} bytes`;
  }
  if (
    edge.labelOffset !== undefined &&
    (!Number.isFinite(edge.labelOffset) || edge.labelOffset < 0 || edge.labelOffset > 1)
  ) {
    return `Edge ${edge.id} has a label offset outside 0..1`;
  }
  if (!edgeKinds.includes(edge.kind)) return `Edge ${edge.id} has an unknown kind`;
  if (!edgePaths.includes(edge.path)) return `Edge ${edge.id} has an unknown path`;
  if (edge.source === edge.target) return `Edge ${edge.id} connects a card to itself`;
  if (context.isCardLive) {
    if (!context.isCardLive(edge.source)) {
      return `Edge ${edge.id} starts at a card that does not exist: "${edge.source}"`;
    }
    if (!context.isCardLive(edge.target)) {
      return `Edge ${edge.id} points at a card that does not exist: "${edge.target}"`;
    }
  }
  return null;
}
