import type { DrawingElement } from "@suite/graph";
import { ATTACHMENT_ID_PATTERN, attachmentUrl } from "../editor/attachmentNode";

/**
 * A picture inside a sketch.
 *
 * Excalidraw names an image's bytes with a `fileId` it invents, and the relay
 * names them with a 32-character hex id of its own, so the two are mapped rather
 * than reconciled. The mapping rides on the image element's own `customData`,
 * which the drawing schema's passthrough already carries and Excalidraw
 * round-trips untouched: a stored element is enough to find its bytes again, on
 * this machine or on a peer's.
 */
export interface SketchFileRef {
  fileId: string;
  attachmentId: string;
}

/** The attachment that holds one element's bytes, or null when it has none yet. */
export function sketchAttachmentId(element: DrawingElement): string | null {
  const custom = element.customData;
  if (typeof custom !== "object" || custom === null) return null;
  const suite = (custom as { suiteFile?: unknown }).suiteFile;
  if (typeof suite !== "object" || suite === null) return null;
  const id = (suite as { id?: unknown }).id;
  return typeof id === "string" && ATTACHMENT_ID_PATTERN.test(id) ? id : null;
}

/** Every stored picture in a scene, once per `fileId`. */
export function sketchFileRefs(elements: readonly DrawingElement[]): SketchFileRef[] {
  const seen = new Set<string>();
  const refs: SketchFileRef[] = [];
  for (const element of elements) {
    const fileId = (element as { fileId?: unknown }).fileId;
    if (typeof fileId !== "string" || seen.has(fileId)) continue;
    const attachmentId = sketchAttachmentId(element);
    if (attachmentId === null) continue;
    seen.add(fileId);
    refs.push({ fileId, attachmentId });
  }
  return refs;
}

/**
 * One element with its picture recorded on it.
 *
 * A copy, so the caller keeps the scene Excalidraw handed it. Elements that point
 * at a different file are returned as they are.
 */
export function withSketchFile(
  element: DrawingElement,
  fileId: string,
  attachmentId: string,
): DrawingElement {
  if ((element as { fileId?: unknown }).fileId !== fileId) return element;
  const custom = element.customData;
  const merged = typeof custom === "object" && custom !== null ? { ...custom } : {};
  return {
    ...element,
    customData: { ...merged, suiteFile: { id: attachmentId } },
  } as DrawingElement;
}

/** Where the bytes of one stored picture are served from. */
export function sketchFileUrl(attachmentId: string): string {
  return attachmentUrl(attachmentId);
}

/** The bytes behind a `data:` URL, or null when the URL is not a base64 one. */
export function bytesFromDataUrl(dataUrl: string): Uint8Array | null {
  const comma = dataUrl.indexOf(",");
  if (comma < 0 || !dataUrl.slice(0, comma).includes("base64")) return null;
  let binary: string;
  try {
    binary = atob(dataUrl.slice(comma + 1));
  } catch {
    return null;
  }
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

/** Bytes as a `data:` URL, the shape Excalidraw keeps an image in. */
export function dataUrlOf(bytes: Uint8Array, mime: string): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `data:${mime};base64,${btoa(binary)}`;
}

/**
 * One stored picture's bytes from the relay, or null when it will not serve them.
 *
 * That route needs no credential: the id is the read capability, so a share
 * viewer holding the element can draw the picture too.
 */
export async function fetchPicture(ref: SketchFileRef): Promise<{
  bytes: Uint8Array;
  mime: string;
} | null> {
  try {
    const response = await fetch(sketchFileUrl(ref.attachmentId));
    if (!response.ok) return null;
    const mime = response.headers.get("content-type") ?? "image/png";
    return { bytes: new Uint8Array(await response.arrayBuffer()), mime };
  } catch {
    return null;
  }
}
