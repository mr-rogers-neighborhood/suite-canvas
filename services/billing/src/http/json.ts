import type { IncomingMessage, ServerResponse } from "node:http";
import { err, ok, type Result } from "neverthrow";
import { BillingError, billingFailureOf } from "../errors.ts";

/**
 * The two HTTP primitives a route module needs: read one small JSON body, write one JSON
 * answer.
 *
 * They live here rather than in the control plane so the module that mounts them stays a
 * routing decision, and so the body limit is testable without a server.
 */

/** A billing request body is a handful of ids. Anything larger is not ours. */
export const MAX_BODY_BYTES = 64 * 1024;

/** Reads the body and parses it, or says why it cannot be used. */
export async function readJsonBody(
  request: IncomingMessage,
  limit: number = MAX_BODY_BYTES,
): Promise<Result<unknown, BillingError>> {
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    for await (const chunk of request as AsyncIterable<unknown>) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
      size += buffer.byteLength;
      if (size > limit) {
        // Keep draining nothing: an oversized body is refused, and the socket closes
        // with the response rather than absorbing the rest of it.
        return err(new BillingError("invalid-request", `body is larger than ${limit} bytes`));
      }
      chunks.push(buffer);
    }
  } catch (error) {
    return err(billingFailureOf(error));
  }

  const text = Buffer.concat(chunks).toString("utf8").trim();
  if (text.length === 0) {
    return err(new BillingError("invalid-request", "body is empty"));
  }
  try {
    return ok(JSON.parse(text));
  } catch {
    return err(new BillingError("invalid-request", "body is not JSON"));
  }
}

/** Writes a JSON answer with no caching, which is what every billing response wants. */
export function sendJson(response: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(text),
    "cache-control": "no-store",
  });
  response.end(text);
}

/** The status a failure answers with. Configuration faults are ours, not the caller's. */
export function statusOf(error: BillingError): number {
  switch (error.code) {
    case "invalid-request":
      return 400;
    case "not-configured":
      return 503;
    default:
      return 500;
  }
}
