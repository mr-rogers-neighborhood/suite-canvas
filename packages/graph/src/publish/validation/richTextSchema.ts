/**
 * Owns the rich-text allowlist: the nodes, marks and attributes a published body may hold,
 * and the constants the attribute checks are measured against.
 */
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
  "image",
  "video",
  "youtube",
  "tourStep",
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
  // A link image: an address to fetch, a label, and the size it draws at.
  image: ["src", "alt", "width", "height"],
  // An attached video: metadata for video bytes stored beside the document.
  video: ["id", "mime", "width", "height", "name", "bytes", "duration"],
  // A YouTube embed: video ID and privacy-enhanced embed source.
  youtube: ["videoId", "src", "title", "width", "height"],
  // A tour step: its stable id, the targets it points at, the camera it asks
  // for, its caption and how a reader leaves it (ADR-0054).
  tourStep: ["stepId", "targets", "viewport", "caption", "advance"],
} as const satisfies Record<string, readonly string[]>;

export const ALLOWED_NODES = new Set<string>(RICH_TEXT_NODE_NAMES);

export const ALLOWED_MARKS = new Set<string>(RICH_TEXT_MARK_NAMES);

export const NODE_FIELDS = new Set(["nodeName", "attributes", "children"]);

export const NODE_ATTRIBUTES: Record<string, ReadonlySet<string>> = Object.fromEntries(
  Object.entries(RICH_TEXT_NODE_ATTRIBUTE_NAMES).map(([nodeName, attributes]) => [
    nodeName,
    new Set(attributes),
  ]),
);

export const IMAGE_URL_MAX_LENGTH = 2048;

export const IMAGE_ALT_MAX_BYTES = 200;

/**
 * The attachment node's attributes are metadata for bytes held elsewhere, so a
 * publish checks their shape: an id the relay could have issued, a type it
 * serves, sizes that are whole numbers, and a name short enough to be alt text.
 * Anything else would project a node no reader could ever resolve.
 */
export const ATTACHMENT_ID = /^[0-9a-f]{32}$/u;

export const ATTACHMENT_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/avif",
  "video/mp4",
  "video/webm",
  "video/ogg",
  "video/quicktime",
]);

export const ATTACHMENT_MAX_NAME_BYTES = 200;
