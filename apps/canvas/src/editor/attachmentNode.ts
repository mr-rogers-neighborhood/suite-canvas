import { mergeAttributes, Node, ReactNodeViewRenderer } from "@tiptap/react";
import { collabHttpBase } from "../session/endpoints";
import { AttachmentView } from "./AttachmentView";

export const ATTACHMENT_NODE_NAME = "attachment";

/** Types the relay accepts; also the types a pasted clipboard image may carry. */
export const ATTACHMENT_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/avif",
] as const;

export type AttachmentMime = (typeof ATTACHMENT_MIME_TYPES)[number];

/** A 128-bit id, lowercase hex: the relay names the bytes with it. */
export const ATTACHMENT_ID_PATTERN = /^[0-9a-f]{32}$/u;

export function isAttachmentMime(value: string | null | undefined): value is AttachmentMime {
  if (typeof value !== "string") return false;
  return (ATTACHMENT_MIME_TYPES as readonly string[]).includes(value.toLowerCase());
}

export function attachmentId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Bytes as a Blob. The cast is only the DOM typings: `BlobPart` is declared over
 * `ArrayBufferView<ArrayBuffer>`, and a plain `Uint8Array` is one at runtime.
 */
export function attachmentBlob(bytes: Uint8Array, mime: string): Blob {
  return new Blob([bytes as unknown as BlobPart], { type: mime });
}

/** The page this app runs on, or null outside a browser (a unit test, a share card render). */
export function pageLocation(): Location | null {
  return typeof window === "undefined" ? null : window.location;
}

/**
 * Where the relay serves one attachment's bytes. The id is the whole
 * credential, so a share viewer holding a projected node can read exactly that
 * image and nothing else.
 *
 * The page location is passed to `collabHttpBase` explicitly because this module
 * belongs to the editor schema in *both* build profiles: it only builds a URL,
 * and an image actually requests one only where a reader can see the node.
 */
export function attachmentUrl(id: string): string {
  return `${collabHttpBase(pageLocation())}/api/attachments/${encodeURIComponent(id)}`;
}

/**
 * An inline image whose bytes live beside the document.
 *
 * The node carries metadata only — never the bytes — because a share projection
 * copies the document: storing pixels in it would put a private copy of every
 * image in every link. The id, mime, size and name are enough to draw the image
 * from the relay, or a placeholder when the bytes are not reachable here.
 */
export const Attachment = Node.create({
  name: ATTACHMENT_NODE_NAME,
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    const attribute = (name: string, dataName: string) => ({
      default: null,
      parseHTML: (element: HTMLElement) => {
        const value = element.getAttribute(dataName);
        if (value === null) return null;
        if (name === "width" || name === "height" || name === "bytes") {
          const number = Number(value);
          return Number.isFinite(number) && number >= 0 ? number : null;
        }
        return value;
      },
      renderHTML: (attributes: Record<string, unknown>) => {
        const value = attributes[name];
        return value === null || value === undefined ? {} : { [dataName]: String(value) };
      },
    });

    return {
      /** Relay id of the bytes. Metadata only; never a data URL. */
      id: attribute("id", "data-attachment-id"),
      mime: attribute("mime", "data-attachment-mime"),
      width: attribute("width", "data-attachment-width"),
      height: attribute("height", "data-attachment-height"),
      /** Alt text, and the label the placeholder shows. */
      name: attribute("name", "data-attachment-name"),
      /** Byte count, so a projection says how large the image is without holding it. */
      bytes: attribute("bytes", "data-attachment-bytes"),
    };
  },

  parseHTML() {
    return [{ tag: "img[data-attachment-id]" }];
  },

  // Copy, export and plain HTML carry the metadata plus the URL the relay
  // serves the bytes from; the bytes themselves are never serialized.
  renderHTML({ node, HTMLAttributes }) {
    const id = typeof node.attrs.id === "string" ? node.attrs.id : "";
    const name = typeof node.attrs.name === "string" ? node.attrs.name : "";
    return [
      "img",
      mergeAttributes(
        {
          "data-attachment-id": id,
          src: id.length > 0 ? attachmentUrl(id) : null,
          alt: name || "Attached image",
        },
        HTMLAttributes,
      ),
    ];
  },

  // A node view, not the plain `img`: it can read this browser's local copy
  // first and show a placeholder when neither copy is reachable.
  addNodeView() {
    return ReactNodeViewRenderer(AttachmentView);
  },
});

/* -------------------------------------------------- local byte cache (IndexedDB) */

/**
 * The same bytes a paste could not upload. IndexedDB, not localStorage: image
 * bytes are binary and can be megabytes, and a synchronous string store would
 * bloat every save. The key is the node's id, so an offline paste and the upload
 * it later makes are the same attachment.
 */
const LOCAL_DATABASE = "suite-attachments";
const LOCAL_STORE = "bytes";
const LOCAL_VERSION = 1;

/**
 * What this browser knows about an image's journey to the relay.
 *
 * - `local`: the bytes are here and have *not* been accepted by a relay, so a
 *   collaborator or another device sees a placeholder.
 * - `synced`: a relay accepted these bytes under this id.
 * - `unknown`: this browser holds no record of the image, or holds one written
 *   before the flag existed. Nothing may be claimed about it.
 */
export type AttachmentUploadState = "local" | "synced" | "unknown";

interface LocalRecord {
  id: string;
  mime: string;
  bytes: Uint8Array;
  createdAt: number;
  /**
   * Whether the relay accepted these bytes. Optional because records written
   * before this field existed carry no answer: those read `unknown`, never
   * `local`, so the editor does not show a caption that might be false.
   */
  uploadState?: "local" | "synced";
  /** When the relay accepted the bytes; absent until then. */
  uploadedAt?: number;
}

/** The single mapping from a stored record to what a surface may say about it. */
function uploadStateOf(record: LocalRecord | null): AttachmentUploadState {
  if (record === null) return "unknown";
  return record.uploadState === "local" || record.uploadState === "synced"
    ? record.uploadState
    : "unknown";
}

function openLocalDatabase(): Promise<IDBDatabase> | null {
  // jsdom, a share viewer in a locked-down browser, and any page without
  // IndexedDB simply have no local cache; every caller treats that as "absent".
  if (typeof indexedDB === "undefined") return null;
  return new Promise<IDBDatabase>((resolve, reject) => {
    const open = indexedDB.open(LOCAL_DATABASE, LOCAL_VERSION);
    open.onupgradeneeded = () => {
      if (!open.result.objectStoreNames.contains(LOCAL_STORE)) {
        open.result.createObjectStore(LOCAL_STORE, { keyPath: "id" });
      }
    };
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error ?? new Error("could not open IndexedDB"));
  });
}

/** One local record, including what this browser knows about its upload. */
async function readLocalRecord(id: string): Promise<LocalRecord | null> {
  const database = openLocalDatabase();
  if (database === null || !ATTACHMENT_ID_PATTERN.test(id)) return null;
  try {
    const db = await database;
    try {
      const record = await new Promise<LocalRecord | undefined>((resolve, reject) => {
        const transaction = db.transaction(LOCAL_STORE, "readonly");
        const request = transaction.objectStore(LOCAL_STORE).get(id);
        request.onsuccess = () => resolve(request.result as LocalRecord | undefined);
        request.onerror = () => reject(request.error ?? new Error("could not read the image"));
      });
      return record ?? null;
    } finally {
      db.close();
    }
  } catch (error) {
    console.warn("[attachments] could not read the local copy", error);
    return null;
  }
}

/** Writes one record whole. Never throws: a paste must still land. */
async function putLocalRecord(record: LocalRecord): Promise<void> {
  const database = openLocalDatabase();
  if (database === null) return;
  try {
    const db = await database;
    try {
      await new Promise<void>((resolve, reject) => {
        const transaction = db.transaction(LOCAL_STORE, "readwrite");
        transaction.objectStore(LOCAL_STORE).put(record);
        transaction.oncomplete = () => resolve();
        transaction.onerror = () =>
          reject(transaction.error ?? new Error("could not store the image"));
        transaction.onabort = () => reject(transaction.error ?? new Error("storage aborted"));
      });
    } finally {
      db.close();
    }
  } catch (error) {
    console.warn("[attachments] could not keep a local copy", error);
  }
}

/**
 * Keeps a local copy under the node's id, marked `local`: these bytes exist
 * only on this device until a relay accepts them. Never throws: a paste must
 * still land even when storage is unavailable.
 */
export async function storeLocalAttachment(
  id: string,
  bytes: Uint8Array,
  mime: string,
): Promise<void> {
  await putLocalRecord({ id, mime, bytes, createdAt: Date.now(), uploadState: "local" });
}

/**
 * Records that a relay accepted these bytes, so a later read says `synced`.
 *
 * Flipping is a no-op when this browser holds no record: a paste that uploaded
 * first never wrote one, and "no record" already reads `unknown`, which shows
 * no caption. Called after a successful upload so a retry under an id this
 * browser had kept locally clears the pending notice.
 */
export async function markAttachmentUploaded(id: string): Promise<void> {
  const record = await readLocalRecord(id);
  if (record === null || record.uploadState === "synced") return;
  await putLocalRecord({ ...record, uploadState: "synced", uploadedAt: Date.now() });
}

/**
 * What this browser knows about one attachment: `local`, `synced` or
 * `unknown`. The one accessor every surface uses, so the editor and a future
 * retry/export UI cannot disagree about the same record. A record written
 * before the flag existed reads `unknown`, not `local`.
 */
export async function attachmentUploadState(id: string): Promise<AttachmentUploadState> {
  return uploadStateOf(await readLocalRecord(id));
}

/** The local copy for one id, plus the upload fact stored beside it. */
export async function readLocalAttachment(
  id: string,
): Promise<{ bytes: Uint8Array; mime: string; uploadState: AttachmentUploadState } | null> {
  const record = await readLocalRecord(id);
  if (record === null) return null;
  return {
    bytes: new Uint8Array(record.bytes),
    mime: record.mime,
    uploadState: uploadStateOf(record),
  };
}

/** Drops a local copy, used once the relay holds the bytes. */
export async function deleteLocalAttachment(id: string): Promise<void> {
  const database = openLocalDatabase();
  if (database === null) return;
  try {
    const db = await database;
    try {
      await new Promise<void>((resolve, reject) => {
        const transaction = db.transaction(LOCAL_STORE, "readwrite");
        transaction.objectStore(LOCAL_STORE).delete(id);
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error ?? new Error("could not delete"));
      });
    } finally {
      db.close();
    }
  } catch (error) {
    console.warn("[attachments] could not drop the local copy", error);
  }
}
