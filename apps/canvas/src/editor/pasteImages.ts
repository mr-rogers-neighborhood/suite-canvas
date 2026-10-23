import { Plugin, PluginKey } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { Extension } from "@tiptap/react";
import { collabHttpBase } from "../session/endpoints";
import { isStandalone } from "../session/mode";
import { getSession } from "../session/session";
import {
  ATTACHMENT_NODE_NAME,
  attachmentBlob,
  attachmentId,
  isAttachmentMime,
  pageLocation,
  storeLocalAttachment,
} from "./attachmentNode";

/** One pasted image on its way to the relay. */
export interface PasteUpload {
  /** Id the node will carry; also the id the relay stores the bytes under. */
  id: string;
  bytes: Uint8Array;
  mime: string;
}

export type PasteUploader = (input: PasteUpload) => Promise<void>;

export interface PasteImagesOptions {
  /**
   * Uploads one image. `null` means this page has no relay: the bytes stay in
   * IndexedDB. Leaving it undefined picks the relay automatically.
   */
  upload?: PasteUploader | null;
  /** Local byte cache; IndexedDB unless a test supplies its own. */
  storeLocal?: (id: string, bytes: Uint8Array, mime: string) => Promise<void>;
  /** Image dimensions; a decode probe unless a test supplies its own. */
  measure?: (bytes: Uint8Array, mime: string) => Promise<{ width: number; height: number } | null>;
  /** Node ids; random unless a test supplies its own. */
  newId?: () => string;
  /** Filename used as alt text when the clipboard item has no usable name. */
  fallbackName?: string;
}

const PASTE_IMAGES_KEY = new PluginKey("pasteImages");

/** `image/png` from `image/png` — the clipboard already gives a bare type. */
function clipboardMime(type: string): string {
  return type.split(";")[0]?.trim().toLowerCase() ?? "";
}

/** One HTTP call. Injectable, so a test needs no server. */
export type RelayRequest = (url: string, init: RequestInit) => Promise<Response>;

/**
 * The transport, taken from `globalThis` so it stays injectable (a test passes
 * its own) and so this module holds no call of its own. `relayUploader` is the
 * profile gate: a standalone build, an offline tab and a share session (which
 * holds a link token, never an owner key) all return null before a request is
 * built, so nothing here is reached without a relay to reach.
 */
function platformRequest(): RelayRequest | null {
  const implementation = (globalThis as { fetch?: unknown }).fetch;
  return typeof implementation === "function"
    ? (implementation as RelayRequest).bind(globalThis)
    : null;
}

/**
 * Uploads one pasted image to the relay, or returns null when this page cannot
 * upload: a standalone build has no relay at all, an offline browser has none
 * reachable, and a share session only ever holds a link token — never an owner
 * key — so it must not try. Returning a function here is the "relay configured"
 * test the paste path relies on.
 */
export function relayUploader(
  request: RelayRequest | null = platformRequest(),
): PasteUploader | null {
  if (request === null) return null;
  if (typeof window === "undefined") return null;
  if (isStandalone()) return null;
  if (typeof navigator !== "undefined" && navigator.onLine === false) return null;

  const session = getSession();
  if (session.workspaceId === null || session.ownerKey === null) return null;
  const workspaceId = session.workspaceId;
  const ownerKey = session.ownerKey;

  return async ({ id, bytes, mime }) => {
    const response = await request(
      `${collabHttpBase(pageLocation())}/api/attachments/${encodeURIComponent(workspaceId)}`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${ownerKey}`,
          "content-type": mime,
          // The node already carries this id; the relay stores under it, so an
          // offline copy and its later upload are the same attachment.
          "x-suite-attachment-id": id,
        },
        body: bytes as unknown as BodyInit,
      },
    );
    if (!response.ok) {
      throw new Error(`The relay refused the image (${response.status}).`);
    }
  };
}

/** Dimensions from the decoded image, or null when this browser cannot decode it. */
async function measureImage(
  bytes: Uint8Array,
  mime: string,
): Promise<{ width: number; height: number } | null> {
  const blob = attachmentBlob(bytes, mime);
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(blob);
      const size = { width: bitmap.width, height: bitmap.height };
      bitmap.close?.();
      return size;
    } catch {
      return null;
    }
  }
  if (typeof Image === "undefined" || typeof URL.createObjectURL !== "function") return null;
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const image = new Image();
    let settled = false;
    const finish = (size: { width: number; height: number } | null) => {
      if (settled) return;
      settled = true;
      URL.revokeObjectURL(url);
      resolve(size);
    };
    image.onload = () => finish({ width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = () => finish(null);
    image.src = url;
    // A probe that never answers must not hold the paste; the node lands with
    // the dimensions left null and the image still renders at its own size.
    setTimeout(() => finish(null), 750);
  });
}

/** The image files of one paste, in clipboard order. */
function clipboardImages(event: ClipboardEvent): File[] {
  const items = event.clipboardData?.items;
  if (!items) return [];
  const files: File[] = [];
  for (const item of Array.from(items)) {
    if (item.kind !== "file") continue;
    const mime = clipboardMime(item.type);
    if (!isAttachmentMime(mime)) continue;
    const file = item.getAsFile();
    if (file) files.push(file);
  }
  return files;
}

/** Inserts one attachment node at the current selection. */
function insertAttachment(
  view: EditorView,
  attrs: {
    id: string;
    mime: string;
    width: number | null;
    height: number | null;
    name: string;
    bytes: number;
  },
): void {
  if (view.isDestroyed) return;
  const type = view.state.schema.nodes[ATTACHMENT_NODE_NAME];
  if (!type) return;
  try {
    view.dispatch(view.state.tr.replaceSelectionWith(type.create(attrs)).scrollIntoView());
  } catch (error) {
    // A paste inside a node that cannot hold an inline atom (a code block, say)
    // is refused by the schema; the editor keeps the document it had.
    console.warn("[attachments] could not insert the image here", error);
  }
}

async function insertImages(
  view: EditorView,
  files: File[],
  options: PasteImagesOptions,
): Promise<void> {
  const upload = options.upload === undefined ? relayUploader() : options.upload;
  const storeLocal = options.storeLocal ?? storeLocalAttachment;
  const measure = options.measure ?? measureImage;
  const newId = options.newId ?? attachmentId;

  for (const file of files) {
    const mime = clipboardMime(file.type);
    if (!isAttachmentMime(mime)) continue;
    const bytes = new Uint8Array(await file.arrayBuffer());
    const id = newId();

    let uploaded = false;
    if (upload !== null) {
      try {
        await upload({ id, bytes, mime });
        uploaded = true;
      } catch (error) {
        // A relay that is unreachable right now is not a lost paste: keep the
        // bytes locally and let the node render here, exactly as offline does.
        console.warn("[attachments] upload failed; keeping the image locally", error);
      }
    }
    if (!uploaded) {
      // LOCAL-ONLY: with no relay (standalone build, offline tab, share session)
      // these bytes live in this browser's IndexedDB and nowhere else. The card
      // renders here, but a share viewer has no way to fetch them until the node
      // is uploaded under the same id, so the image is missing for that reader.
      await storeLocal(id, bytes, mime);
    }

    const size = await measure(bytes, mime);
    insertAttachment(view, {
      id,
      mime,
      width: size?.width ?? null,
      height: size?.height ?? null,
      name: file.name || options.fallbackName || "Pasted image",
      bytes: bytes.byteLength,
    });
  }
}

/**
 * Pastes images as attachment nodes.
 *
 * A pasted image is never inlined as a data URL: the node stores metadata and
 * the bytes go to the relay (or, with no relay, to IndexedDB), which is what
 * keeps a share projection from carrying a copy of every image.
 */
export const PasteImages = Extension.create<PasteImagesOptions>({
  name: "pasteImages",

  addProseMirrorPlugins() {
    const options = this.options;
    return [
      new Plugin({
        key: PASTE_IMAGES_KEY,
        props: {
          handlePaste: (view, event) => {
            const files = clipboardImages(event);
            if (files.length === 0) return false;
            // The default paste is claimed now; the nodes land when the upload
            // (or the local write) finishes, so ProseMirror never inserts the
            // image as HTML or file data of its own.
            void insertImages(view, files, options).catch((error: unknown) => {
              console.error("[attachments] paste failed", error);
            });
            return true;
          },
        },
      }),
    ];
  },
});
