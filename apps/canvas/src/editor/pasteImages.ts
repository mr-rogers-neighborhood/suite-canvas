import { Plugin, PluginKey } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { Extension } from "@tiptap/react";
import {
  attachmentBlob,
  attachmentId,
  isAttachmentMime,
  storeLocalAttachment,
} from "./attachmentNode";
import { imageAltFromSrc, imageLinkFromText } from "./imageLinkNode";
import { closeImageUrlPrompt } from "./imageUrlPrompt";
import { insertMediaAfter, insertMediaNode, type MediaAttrs } from "./mediaNode";

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
  /** Ignored. A caller that used to pass a relay uploader is now passing nothing. */
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
 * No uploader exists.
 *
 * This used to return a function when the page had a relay to reach: not in a
 * standalone build, not offline, and never for a share session, which held a link
 * token rather than an account session. Every caller treats `null` as "these bytes
 * stay in this window", which is now the only answer.
 */
export function relayUploader(): PasteUploader | null {
  return null;
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

/** The clipboard's plain text, which is where a copied image URL arrives. */
function clipboardText(event: ClipboardEvent): string {
  return event.clipboardData?.getData("text/plain") ?? "";
}

/** Inserts one image block for the bytes that just landed. */
/**
 * One file, prepared: its bytes stored and uploaded, and the attributes a `media` block needs.
 *
 * Split out from the insert because there are two places a block can land — at the caret of an editor, and in a
 * card made where the reader right-clicked — and storing the bytes is the same work either way. The local copy
 * lives here so no caller can skip it.
 */
export async function prepareMediaFile(
  file: File,
  options: PasteImagesOptions = {},
): Promise<MediaAttrs | null> {
  const storeLocal = options.storeLocal ?? storeLocalAttachment;
  const measure = options.measure ?? measureImage;
  const newId = options.newId ?? attachmentId;

  const mime = clipboardMime(file.type);
  if (!isAttachmentMime(mime)) return null;
  const bytes = new Uint8Array(await file.arrayBuffer());
  const id = newId();

  // The bytes live in this browser's IndexedDB and nowhere else: there is no
  // relay to hand them to, and no second copy to keep in step.
  await storeLocal(id, bytes, mime);

  const name = file.name || options.fallbackName || "Attached file";
  if (mime === "application/epub+zip") {
    return { kind: "epub", id, mime, name, bytes: bytes.byteLength };
  }
  if (mime.startsWith("video/")) {
    return {
      kind: "video",
      id,
      mime,
      width: null,
      height: null,
      name,
      bytes: bytes.byteLength,
      duration: null,
    };
  }
  const size = await measure(bytes, mime);
  return {
    kind: "image",
    id,
    mime,
    width: size?.width ?? null,
    height: size?.height ?? null,
    name,
    bytes: bytes.byteLength,
  };
}

/** Files into one editor, at the caret: the paste, the drop and the picker's editor target. */
export async function insertMediaFiles(
  view: EditorView,
  files: File[],
  options: PasteImagesOptions = {},
): Promise<void> {
  for (const file of files) {
    const attrs = await prepareMediaFile(file, options);
    if (attrs !== null) insertMediaNode(view, attrs);
  }
}

export const insertImages = insertMediaFiles;

/**
 * Pastes images as attachment nodes.
 *
 * A pasted image is never inlined as a data URL: the node stores metadata and
 * the bytes go to the relay (or, with no relay, to IndexedDB), which is what
 * keeps a share projection from carrying a copy of every image.
 */
function dragDropMedia(event: DragEvent): File[] {
  const files = event.dataTransfer?.files;
  if (!files || files.length === 0) return [];
  const valid: File[] = [];
  for (const file of Array.from(files)) {
    const mime = clipboardMime(file.type);
    if (isAttachmentMime(mime)) valid.push(file);
  }
  return valid;
}

export const PasteImages = Extension.create<PasteImagesOptions>({
  name: "pasteImages",

  addProseMirrorPlugins() {
    const options = this.options;
    return [
      new Plugin({
        key: PASTE_IMAGES_KEY,
        props: {
          handleDrop: (view, event) => {
            const files = dragDropMedia(event);
            if (files.length > 0) {
              closeImageUrlPrompt(view);
              void insertMediaFiles(view, files, options).catch((error: unknown) => {
                console.error("[attachments] drop failed", error);
              });
              return true;
            }
            return false;
          },
          handlePaste: (view, event) => {
            const files = clipboardImages(event);
            if (files.length > 0) {
              // Bytes win over a URL when a clipboard carries both: the user
              // had a real image, and dropping it for a link would lose the
              // pixels they copied (and leave them dependent on a third party).
              // The default paste is claimed now; the nodes land when the
              // upload (or the local write) finishes, so ProseMirror never
              // inserts the image as HTML or file data of its own.
              closeImageUrlPrompt(view);
              void insertImages(view, files, options).catch((error: unknown) => {
                console.error("[attachments] paste failed", error);
              });
              return true;
            }
            // No bytes: a bare image URL becomes a link node, so an image
            // copied from a web page can be placed without a relay or storage.
            // A `javascript:` or `data:` URL never reaches here:
            // `imageLinkFromText` refuses anything but http and https.
            const url = imageLinkFromText(clipboardText(event));
            if (url === null) return false;
            // A URL pasted into an open prompt answers it, so the hint goes
            // away with the paragraph that held it.
            closeImageUrlPrompt(view);
            return insertMediaAfter(view, view.state.selection.from, {
              kind: "image",
              src: url,
              alt: imageAltFromSrc(url),
            });
          },
        },
      }),
    ];
  },
});
