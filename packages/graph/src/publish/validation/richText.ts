import { z } from "zod";
import type { RichTextSnapshot, RichTextTextSnapshot } from "../../merge.js";
import { targetSchema } from "../../target.js";
import { tourStepAdvanceSchema, tourStepViewportSchema } from "../../tutorial.js";

import { DEFAULT_PUBLISH_LIMITS, type PublishLimits, utf8ByteLength } from "./limits.js";
import {
  ALLOWED_MARKS,
  ALLOWED_NODES,
  ATTACHMENT_ID,
  ATTACHMENT_MAX_NAME_BYTES,
  ATTACHMENT_MIME_TYPES,
  IMAGE_ALT_MAX_BYTES,
  IMAGE_URL_MAX_LENGTH,
  NODE_ATTRIBUTES,
  NODE_FIELDS,
} from "./richTextSchema.js";

/**
 * Owns the rich-text checks: one validator per allowed node and attribute, the tree walk
 * that applies them, and the byte count a tree costs.
 */

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
 * A link image stores an address, not bytes, so a publish checks that a
 * reader's browser may fetch it: http or https only, no whitespace, and bounded
 * in length. The schemes that execute or embed — `javascript:`, `data:`,
 * `file:` — are refused by name so the reason says which scheme it was; a
 * handed-in draft can hold any string, and a viewer must never hand it to `src`.
 * Alt text is a label, so it is capped like the attachment's name.
 */
function validateImageAttribute(key: string, value: string | number | boolean): string | null {
  if (key === "src") {
    if (typeof value !== "string" || value.trim().length === 0) {
      return "is empty; an image link needs an http or https URL";
    }
    if (value.length > IMAGE_URL_MAX_LENGTH) {
      return `is longer than ${IMAGE_URL_MAX_LENGTH} characters`;
    }
    for (const character of value) {
      if (character.charCodeAt(0) <= 0x20) {
        return "contains whitespace or a control character";
      }
    }
    if (/^javascript:/iu.test(value)) {
      return "uses the javascript: scheme; only http and https image links are allowed";
    }
    if (/^data:/iu.test(value)) {
      return "uses the data: scheme; an image link is a URL, never inlined bytes";
    }
    if (/^file:/iu.test(value)) {
      return "uses the file: scheme; only http and https image links are allowed";
    }
    if (!/^https?:\/\//iu.test(value)) return "is not an http or https URL";
    try {
      new URL(value);
      return null;
    } catch {
      return "is not a valid URL";
    }
  }
  if (key === "alt") {
    if (typeof value !== "string") return "is not text";
    return utf8ByteLength(value) <= IMAGE_ALT_MAX_BYTES
      ? null
      : `is longer than ${IMAGE_ALT_MAX_BYTES} bytes`;
  }
  if (key === "width" || key === "height") {
    return typeof value === "number" && Number.isInteger(value) && value >= 0
      ? null
      : "is not a non-negative whole number";
  }
  return null;
}

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

/**
 * A tour step's two structured attributes: the targets it points at and the
 * camera it asks for. A published tour a reader cannot resolve is worse than a
 * tour without that step, so a malformed one is refused rather than clipped.
 */
function validateTourStepAttribute(key: string, value: unknown): string | null {
  if (key === "targets") {
    const parsed = z.array(targetSchema).min(1).safeParse(value);
    return parsed.success ? null : "is not a non-empty list of targets";
  }
  if (key === "viewport") {
    const parsed = tourStepViewportSchema.safeParse(value);
    return parsed.success ? null : "is not a camera";
  }
  if (key === "advance") {
    return tourStepAdvanceSchema.safeParse(value).success ? null : "is not an advance mode";
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
    if (value === null) {
      // A link without an address projects a placeholder nothing can resolve.
      if (nodeName === "image" && key === "src") {
        return `${path}.src is empty; an image link needs an http or https URL`;
      }
      continue;
    }
    // A tour step stores structured values on purpose: a list of targets and
    // the camera it asks for. They are validated by their own schemas below.
    const structured = nodeName === "tourStep" && (key === "targets" || key === "viewport");
    const ok = structured
      ? true
      : typeof value === "string"
        ? true
        : typeof value === "boolean"
          ? true
          : typeof value === "number" && Number.isFinite(value);
    if (!ok) return `${path}.${key} is not a plain value`;
    if (nodeName === "attachment") {
      const issue = validateAttachmentAttribute(key, value as string | number | boolean);
      if (issue !== null) return `${path}.${key} ${issue}`;
    }
    if (nodeName === "image") {
      const issue = validateImageAttribute(key, value as string | number | boolean);
      if (issue !== null) return `${path}.${key} ${issue}`;
    }
    if (nodeName === "tourStep") {
      const issue = validateTourStepAttribute(key, value);
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
