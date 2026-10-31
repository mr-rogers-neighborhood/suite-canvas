import { Plugin, PluginKey } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { Extension } from "@tiptap/react";
import { canUploadMedia } from "../auth/mediaUploadGating";
import { announceUploadRefusal } from "../auth/uploadRefusal";
import { collabHttpBase } from "../session/endpoints";
import { isStandalone } from "../session/mode";
import { getSession } from "../session/session";
import {
  attachmentBlob,
  attachmentId,
  isAttachmentMime,
  markAttachmentUploaded,
  pageLocation,
  storeLocalAttachment,
} from "./attachmentNode";
import { imageAltFromSrc, imageLinkFromText } from "./imageLinkNode";
import { closeImageUrlPrompt } from "./imageUrlPrompt";
import { insertMediaAfter, insertMediaNode } from "./mediaNode";

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
 * holds a link token, never an account session) all return null before a request
 * is built, so nothing here is reached without a relay to reach.
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
 * reachable, and a share session only ever holds a link token — never the
 * account's session — so it must not try. Returning a function here is the
 * "relay configured" test the paste path relies on.
 */
export function relayUploader(
  request: RelayRequest | null = platformRequest(),
): PasteUploader | null {
  if (request === null) return null;
  if (typeof window === "undefined") return null;
  if (isStandalone()) return null;
  if (typeof navigator !== "undefined" && navigator.onLine === false) return null;

  const session = getSession();
  if (session.workspaceId === null) return null;
  // A share session holds a link token and never the account's session, so it
  // must not try — in any profile. That rule is above the relaxation, not beside it.
  if (session.credential === "share") return null;
  // A development tab often has no account session, and running the relay locally
  // is how this round trip gets tested at all. `import.meta.env.DEV` is folded to
  // false in every production bundle, so the relaxation cannot ship: a deployed
  // build still uploads only as an account.
  const signedIn = session.credential === "account";
  if (!signedIn && !import.meta.env.DEV) return null;
  const workspaceId = session.workspaceId;

  return async ({ id, bytes, mime }) => {
    // Minted per upload: the token the tab booted with has a five-minute life,
    // and a paste can land long after boot. Imported on demand so a build that
    // never uploads never carries the token client.
    const authorization: Record<string, string> = signedIn
      ? await (await import("../auth/credential")).credentialAuthorization()
      : {};
    const response = await request(
      `${collabHttpBase(pageLocation())}/api/attachments/${encodeURIComponent(workspaceId)}`,
      {
        method: "POST",
        headers: {
          ...authorization,
          "content-type": mime,
          // The node already carries this id; the relay stores under it, so an
          // offline copy and its later upload are the same attachment.
          "x-suite-attachment-id": id,
        },
        body: bytes as unknown as BodyInit,
      },
    );
    if (!response.ok) {
      // A full plan is a real answer, not a broken upload: say which one it is
      // and raise the one prompt that can sell more storage.
      if (response.status === 402 || response.status === 413) {
        const { noteRefusal } = await import("../auth/refusal");
        noteRefusal(
          response.status === 413 ? "attachment-limit" : "storage-limit",
          response.status,
        );
      }
      throw Object.assign(new Error(`The relay refused the media (${response.status}).`), {
        status: response.status,
      });
    }
  };
}

/** The HTTP status an upload failed with, when it failed for a stated reason. */
function uploadStatus(error: unknown): number | null {
  if (typeof error !== "object" || error === null || !("status" in error)) return null;
  const status = (error as { status?: unknown }).status;
  return typeof status === "number" ? status : null;
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
function insertImageAttachment(
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
  insertMediaNode(view, { kind: "image", ...attrs });
}

function insertVideoAttachment(
  view: EditorView,
  attrs: {
    id: string;
    mime: string;
    width: number | null;
    height: number | null;
    name: string;
    bytes: number;
    duration: number | null;
  },
): void {
  insertMediaNode(view, { kind: "video", ...attrs });
}

export async function insertMediaFiles(
  view: EditorView,
  files: File[],
  options: PasteImagesOptions = {},
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
        // But a stated refusal is not unreachability — a 401 or a 403 means the
        // bytes will never reach a collaborator, so say so instead of leaving the
        // reader with a card that looks uploaded and is not.
        console.warn("[attachments] upload failed; keeping the media locally", error);
        const status = uploadStatus(error);
        if (status === 401 || status === 403) {
          announceUploadRefusal({
            allowed: false,
            reason:
              status === 401
                ? "Sign in to upload files: an upload needs an account."
                : "This workspace's plan does not include file uploads.",
          });
        }
      }
    }
    if (uploaded) {
      // If this browser still holds a local copy under the id (a retry, or a
      // paste whose earlier attempt failed), the fact that the relay accepted
      // the bytes is recorded beside it, so the pending caption goes away. No
      // retry loop exists today; this keeps the store truthful for one added
      // later rather than growing a background uploader here.
      await markAttachmentUploaded(id);
    }
    if (!uploaded) {
      // LOCAL-ONLY: with no relay (standalone build, offline tab, share session)
      // these bytes live in this browser's IndexedDB and nowhere else. The card
      // renders here, but a share viewer has no way to fetch them until the node
      // is uploaded under the same id, so the image is missing for that reader.
      await storeLocal(id, bytes, mime);
    }

    if (mime.startsWith("video/")) {
      insertVideoAttachment(view, {
        id,
        mime,
        width: null,
        height: null,
        name: file.name || options.fallbackName || "Attached video",
        bytes: bytes.byteLength,
        duration: null,
      });
    } else {
      const size = await measure(bytes, mime);
      insertImageAttachment(view, {
        id,
        mime,
        width: size?.width ?? null,
        height: size?.height ?? null,
        name: file.name || options.fallbackName || "Pasted image",
        bytes: bytes.byteLength,
      });
    }
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
              const permission = canUploadMedia();
              if (!permission.allowed) {
                announceUploadRefusal(permission);
                return true;
              }
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
              const permission = canUploadMedia();
              if (!permission.allowed) {
                announceUploadRefusal(permission);
                return true;
              }
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
