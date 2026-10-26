import type { IncomingMessage, ServerResponse } from "node:http";
import { formatBytes } from "../config/limits.js";
import { createLogger } from "../logging.js";
import {
  ATTACHMENT_ID_PATTERN,
  AttachmentCapError,
  AttachmentExistsError,
  type AttachmentStore,
  attachmentCap,
  attachmentMimeProblem,
  defaultAttachmentStore,
  MAX_ATTACHMENT_BYTES,
  newAttachmentId,
  normalizeMime,
} from "../store/attachments.js";
import { licenceRequired } from "../store/licence.js";
import type { WorkspaceRegistry } from "../store/workspaces.js";
import { HttpError, toProblem } from "./errors.js";
import { applyCors, CORS_HEADERS, sendEmpty, sendJson, sendProblem } from "./respond.js";
import { defaultLicenceClaimStore } from "./workspaceHttp.js";

const logger = createLogger().child({ component: "attachments" });

/** Route prefix. Beside the share and workspace APIs, with its own segment. */
export const ATTACHMENT_API_PATH = "/api/attachments";

/**
 * Client-chosen id header. The editor generates the id before it uploads, so a
 * copy kept in IndexedDB while offline keeps the identity it uploads under. The
 * value is validated like any other id; without it the server makes one.
 */
export const ATTACHMENT_ID_HEADER = "x-suite-attachment-id";

/**
 * Headers every GET answer carries.
 *
 * - `content-type` is the stored type, which passed the allowlist at upload; the
 *   route re-checks it so a hand-edited row is refused rather than served.
 * - `x-content-type-options: nosniff` stops a browser from second-guessing that
 *   type and treating the bytes as HTML.
 * - `content-security-policy: default-src 'none'; sandbox` makes the response
 *   inert even if a browser is pointed at it directly: no script, no frames, no
 *   fetch of anything else.
 * - `content-disposition: inline` with a generated filename keeps it an image
 *   the app can render, never a download with a name the uploader chose.
 * - `cache-control` is immutable because an id names immutable bytes: a GC and
 *   a re-upload always produce a new id.
 * - `cross-origin-resource-policy: cross-origin` lets the canvas on another
 *   origin (the dev server, typically) embed the image.
 */
export const ATTACHMENT_SECURITY_HEADERS: Readonly<Record<string, string>> = {
  "x-content-type-options": "nosniff",
  "content-security-policy": "default-src 'none'; sandbox",
  "cache-control": "public, max-age=31536000, immutable",
  "cross-origin-resource-policy": "cross-origin",
};

const BEARER_PREFIX = /^bearer\s+/iu;

const EXTENSIONS: Readonly<Record<string, string>> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/gif": ".gif",
  "image/webp": ".webp",
  "image/avif": ".avif",
};

export interface AttachmentRequestOptions {
  /** Store to use; the process-wide one by default. */
  store?: AttachmentStore;
  /**
   * Live per-workspace cap. The server passes the resolved limits so a runtime
   * override applies without restarting; the store reads it on every put.
   */
  cap?: () => number;
  /**
   * Per-image cap from a hosted licence, or null on a self-host. Defaults to the
   * claim recorded beside the workspace, which is `Infinity` on a self-host.
   */
  licenceBytes?: (workspaceId: string) => number | null;
}

/** The hosting licence's per-attachment cap, or null when there is no relay licence. */
function licenceAttachmentBytes(workspaceId: string): number | null {
  if (!licenceRequired()) return null;
  const quota = defaultLicenceClaimStore().get(workspaceId)?.quota.attachmentBytes;
  return typeof quota === "number" && Number.isFinite(quota) && quota > 0 ? quota : null;
}

/** The owner key travels in the header, never in the URL and never in a share token. */
function ownerKey(request: IncomingMessage): string {
  const header = request.headers.authorization;
  if (typeof header !== "string") throw HttpError.unauthorized("An owner key is required.");
  const key = header.replace(BEARER_PREFIX, "").trim();
  if (key.length === 0) throw HttpError.unauthorized("An owner key is required.");
  return key;
}

function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    throw HttpError.badRequest("The attachment identifier is malformed.");
  }
}

/** Reads the raw body, bounded before a byte of it reaches SQLite. */
async function readBytes(request: IncomingMessage, maxBytes: number): Promise<Uint8Array> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
    size += buffer.byteLength;
    if (size > maxBytes) {
      throw HttpError.payloadTooLarge(
        `An attachment may be at most ${formatBytes(maxBytes)}; this upload is larger.`,
      );
    }
    chunks.push(buffer);
  }
  if (size === 0) throw HttpError.badRequest("An image body is required.");
  return Buffer.concat(chunks);
}

interface UploadContext {
  request: IncomingMessage;
  response: ServerResponse;
  store: AttachmentStore;
  workspaces: Pick<WorkspaceRegistry, "verify">;
  workspaceId: string;
  options: AttachmentRequestOptions;
}

async function upload(context: UploadContext): Promise<void> {
  const { request, response, store, workspaces, workspaceId, options } = context;

  // Same rule as `/claim`: the owner key the registry already holds. A share
  // token authenticates a room, never an upload, so it is not accepted here and
  // there is no other credential this route reads.
  if (!workspaces.verify(workspaceId, ownerKey(request))) {
    sendJson(response, 403, { error: "The owner key does not match this workspace." });
    return;
  }

  const mime = normalizeMime(request.headers["content-type"]);
  const problem = attachmentMimeProblem(mime);
  if (problem !== null) {
    sendJson(response, 415, { error: problem, reason: "attachment-mime" });
    return;
  }

  const licenceLimit = (options.licenceBytes ?? licenceAttachmentBytes)(workspaceId);
  const maxBytes = Math.min(MAX_ATTACHMENT_BYTES, licenceLimit ?? Number.POSITIVE_INFINITY);
  const bytes = await readBytes(request, maxBytes);

  const header = request.headers[ATTACHMENT_ID_HEADER];
  const requested = typeof header === "string" ? header.trim() : "";
  if (requested.length > 0 && !ATTACHMENT_ID_PATTERN.test(requested)) {
    throw HttpError.badRequest(
      "A client-supplied attachment id must be 32 lowercase hex characters.",
    );
  }
  const id = requested.length > 0 ? requested : newAttachmentId();

  try {
    const meta = store.put(workspaceId, bytes, mime, { id });
    sendJson(response, 201, {
      id: meta.id,
      mime: meta.mime,
      size: meta.size,
      url: `${ATTACHMENT_API_PATH}/${meta.id}`,
    });
  } catch (error) {
    if (error instanceof AttachmentCapError) {
      sendJson(response, 413, { error: error.message, reason: error.reason });
      return;
    }
    if (error instanceof AttachmentExistsError) {
      sendJson(response, 409, { error: error.message, reason: error.reason });
      return;
    }
    throw error;
  }
}

async function download(
  response: ServerResponse,
  store: AttachmentStore,
  id: string,
): Promise<void> {
  if (!ATTACHMENT_ID_PATTERN.test(id)) throw HttpError.notFound("Attachment not found.");
  const record = store.get(id);
  if (record === null) throw HttpError.notFound("Attachment not found.");

  // A row that did not come from `put` is not served at all: the allowlist is
  // the same one uploads pass, checked again at read time.
  const problem = attachmentMimeProblem(record.mime);
  if (problem !== null) throw HttpError.unsupportedMedia(problem);

  const signed = await store.signedRead?.(id, 60_000);
  if (signed) {
    response.writeHead(302, {
      ...CORS_HEADERS,
      location: signed.url,
      "cache-control": "private, max-age=60",
    });
    response.end();
    return;
  }

  response.writeHead(200, {
    ...CORS_HEADERS,
    ...ATTACHMENT_SECURITY_HEADERS,
    "content-type": record.mime,
    "content-length": String(record.size),
    "content-disposition": `inline; filename="${record.id}${EXTENSIONS[record.mime] ?? ""}"`,
  });
  response.end(Buffer.from(record.bytes));
}

function remove(
  request: IncomingMessage,
  response: ServerResponse,
  store: AttachmentStore,
  workspaces: Pick<WorkspaceRegistry, "verify">,
  id: string,
): void {
  if (!ATTACHMENT_ID_PATTERN.test(id)) throw HttpError.notFound("Attachment not found.");
  const record = store.get(id);
  if (record === null) throw HttpError.notFound("Attachment not found.");
  // Only the workspace that owns the bytes may delete them.
  if (!workspaces.verify(record.workspaceId, ownerKey(request))) {
    sendJson(response, 403, { error: "The owner key does not match this workspace." });
    return;
  }
  store.delete(id);
  sendJson(response, 200, { id, deleted: true });
}

/**
 * Serves the attachment API and returns false for every other path, so the
 * caller can keep trying its own routes.
 *
 * Uploads and deletes need the workspace owner key. A read needs only the id:
 * the id is 128 random bits and is the capability a share viewer holds when the
 * projection hands it one, so requiring an owner key would break every share.
 */
export async function handleAttachmentRequest(
  request: IncomingMessage,
  response: ServerResponse,
  workspaces: Pick<WorkspaceRegistry, "verify">,
  options: AttachmentRequestOptions = {},
): Promise<boolean> {
  applyCors(request, response);
  const url = new URL(request.url ?? "/", "http://localhost");
  if (url.pathname !== ATTACHMENT_API_PATH && !url.pathname.startsWith(`${ATTACHMENT_API_PATH}/`)) {
    return false;
  }
  if (response.writableEnded) return true;

  const method = request.method ?? "GET";
  if (method === "OPTIONS") {
    sendEmpty(response, 204);
    return true;
  }

  try {
    const segment = url.pathname.slice(ATTACHMENT_API_PATH.length).replace(/^\//u, "");
    const parts = segment.split("/");
    if (parts.length !== 1 || (parts[0]?.length ?? 0) === 0) throw HttpError.notFound("Not found.");

    const store = options.store ?? defaultAttachmentStore(options.cap ?? attachmentCap);
    const id = decodeSegment(parts[0] ?? "");

    if (method === "POST") {
      await upload({ request, response, store, workspaces, workspaceId: id, options });
      return true;
    }
    if (method === "GET") {
      await download(response, store, id);
      return true;
    }
    if (method === "DELETE") {
      remove(request, response, store, workspaces, id);
      return true;
    }
    throw HttpError.methodNotAllowed();
  } catch (error) {
    if (response.headersSent) return true;
    const problem = toProblem(error);
    if (problem) {
      sendProblem(response, problem);
      return true;
    }
    logger.error("request failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    sendJson(response, 500, { error: "The attachment request failed." });
  }

  return true;
}
