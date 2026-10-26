import type { IncomingMessage } from "node:http";
import { HttpError } from "./errors.js";

/**
 * Request-side middleware: body reading and the credentials a request presents.
 * Every reader throws an `HttpError`, so a handler can stay linear and one
 * `catch` at its boundary answers.
 */

const MAX_BODY_BYTES = 64 * 1024;

async function readBodyBuffer(request: IncomingMessage): Promise<Buffer | null> {
  const chunks: Buffer[] = [];
  let size = 0;

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
    size += buffer.byteLength;
    if (size > MAX_BODY_BYTES) {
      throw HttpError.payloadTooLarge("The request body is too large.");
    }
    chunks.push(buffer);
  }

  return size === 0 ? null : Buffer.concat(chunks);
}

function parseJson(buffer: Buffer): unknown {
  try {
    return JSON.parse(buffer.toString("utf8"));
  } catch {
    throw HttpError.badRequest("The request body must be valid JSON.");
  }
}

export async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const buffer = await readBodyBuffer(request);
  if (!buffer) throw HttpError.badRequest("A JSON body is required.");
  return parseJson(buffer);
}

/** Like `readJsonBody`, but a request with no body is allowed. */
export async function readOptionalJsonBody(request: IncomingMessage): Promise<unknown> {
  const buffer = await readBodyBuffer(request);
  return buffer ? parseJson(buffer) : undefined;
}

const BEARER = /^bearer\s+(.+)$/iu;

/** The bearer credential a request presents, without the legacy header fallback. */
export function bearerToken(request: IncomingMessage): string | null {
  const header = request.headers.authorization;
  const value = Array.isArray(header) ? header[0] : header;
  if (typeof value !== "string") return null;
  const match = BEARER.exec(value.trim());
  const token = match?.[1]?.trim();
  return token && token.length > 0 ? token : null;
}

/**
 * The owner key a management request presents. `Authorization: Bearer` is the
 * documented form; `x-suite-owner` stays accepted for older editors.
 */
export function ownerKeyFrom(request: IncomingMessage): string | null {
  const key = bearerToken(request);
  if (key) return key;
  const fallback = request.headers["x-suite-owner"];
  const alternate = Array.isArray(fallback) ? fallback[0] : fallback;
  const value = alternate?.trim();
  return value && value.length > 0 ? value : null;
}

/**
 * Share management is owner-only. A share token is a capability for one room;
 * it must never mint or revoke links, because the workspace id alone used to be
 * enough to manage them.
 */
