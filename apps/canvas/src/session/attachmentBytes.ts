import { attachmentUrl, readLocalAttachment } from "../editor/attachmentNode";
import type { RelayRequest } from "../editor/pasteImages";
import { isStandalone } from "./mode";

/** One image's bytes and the type they were stored with. */
export interface AttachmentBytes {
  bytes: Uint8Array;
  mime: string;
}

/**
 * Where an export can find an attachment's bytes.
 *
 * Attachment bytes live beside the document: a paste with no relay keeps them
 * in this browser's IndexedDB, an upload keeps them on the relay. A `.suite`
 * export is the only backup, so it has to gather from both. The seam exists so
 * a unit test needs neither IndexedDB nor a server.
 */
export interface AttachmentSource {
  /** Readable name, used in a diagnostic when this source fails. */
  readonly name: string;
  /** The bytes for one node id, or null when this source does not hold them. */
  read(id: string): Promise<AttachmentBytes | null>;
}

/**
 * This browser's copy: what a paste wrote when there was no relay (offline, a
 * standalone build, a share session) or when its upload failed.
 */
export const localAttachmentSource: AttachmentSource = {
  name: "local",
  read: (id) => readLocalAttachment(id),
};

function platformRequest(): RelayRequest | null {
  const implementation = (globalThis as { fetch?: unknown }).fetch;
  return typeof implementation === "function"
    ? (implementation as RelayRequest).bind(globalThis)
    : null;
}

export interface RelayAttachmentOptions {
  /** Transport, so a test needs no server. Defaults to the platform's. */
  request?: RelayRequest | null;
  /** URL of one image; the same route the editor already renders from. */
  url?: (id: string) => string;
}

/**
 * The relay's copy, read with `GET /api/attachments/<id>`.
 *
 * That route needs no credential: the id *is* the read capability, by design, so
 * a share viewer can draw the node too. No `Authorization` header is sent — the
 * route never reads one on GET, and adding it would turn a simple request into a
 * CORS preflight the route does not answer.
 */
export function relayAttachmentSource(
  options: RelayAttachmentOptions = {},
): AttachmentSource | null {
  const request = options.request === undefined ? platformRequest() : options.request;
  if (request === null) return null;
  const url = options.url ?? attachmentUrl;
  return {
    name: "relay",
    async read(id) {
      const response = await request(url(id), { method: "GET" });
      // 404 is "this relay has no such row", which is the same as absent here.
      if (!response.ok) return null;
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.byteLength === 0) return null;
      const mime = (response.headers.get("content-type") ?? "").split(";")[0]?.trim().toLowerCase();
      return { bytes, mime: mime ?? "" };
    },
  };
}

/**
 * The order an export resolves bytes in: local first, then relay.
 *
 * Local wins because an offline paste has no other copy, and because reading
 * this browser's bytes is cheaper than a request. In a standalone build, or
 * offline, there is no relay to ask and the list is just the local store.
 */
export function defaultAttachmentSources(): AttachmentSource[] {
  if (isStandalone()) return [localAttachmentSource];
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return [localAttachmentSource];
  }
  const relay = relayAttachmentSource();
  return relay === null ? [localAttachmentSource] : [localAttachmentSource, relay];
}

/**
 * The first source that holds the bytes, or null when none does. A source that
 * throws is treated as absent: one unreachable store must not fail the export.
 */
export async function resolveAttachmentBytes(
  id: string,
  sources: readonly AttachmentSource[],
): Promise<AttachmentBytes | null> {
  for (const source of sources) {
    try {
      const found = await source.read(id);
      if (found !== null && found.bytes.byteLength > 0) return found;
    } catch (error) {
      console.warn(`[attachments] the ${source.name} copy of ${id} could not be read`, error);
    }
  }
  return null;
}
