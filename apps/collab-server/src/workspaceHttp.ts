import type { IncomingMessage, ServerResponse } from "node:http";
import { HttpError, methodNotAllowed, readJsonBody, sendEmpty, sendJson } from "./http.js";
import { validateClaimInput, type WorkspaceRegistry } from "./workspaces.js";

export const WORKSPACE_API_PATH = "/api/workspaces";

const CONFLICT_MESSAGE = "This workspace is protected by a different owner key.";

function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    throw new HttpError(400, "The workspace identifier is malformed.");
  }
}

function parseOwnerKey(body: unknown): string {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new HttpError(400, "The request body must be a JSON object.");
  }
  const ownerKey = (body as Record<string, unknown>).ownerKey;
  if (typeof ownerKey !== "string" || ownerKey.trim().length === 0) {
    throw new HttpError(400, "An owner key is required.");
  }
  return ownerKey;
}

async function claim(
  request: IncomingMessage,
  response: ServerResponse,
  registry: WorkspaceRegistry,
  workspaceId: string,
): Promise<void> {
  const ownerKey = parseOwnerKey(await readJsonBody(request));
  const problem = validateClaimInput(workspaceId, ownerKey);
  if (problem) throw new HttpError(400, problem);

  const result = registry.claimOrVerify(workspaceId, ownerKey);
  if (result === "mismatch") {
    sendJson(response, 409, { error: CONFLICT_MESSAGE });
    return;
  }
  sendJson(response, 200, { workspaceId: workspaceId.trim(), claimed: true });
}

/**
 * Handles the workspace claim API. Returns false when the request is not one of
 * its routes so the caller can keep serving its own routes.
 */
export async function handleWorkspaceRequest(
  request: IncomingMessage,
  response: ServerResponse,
  registry: WorkspaceRegistry,
): Promise<boolean> {
  const url = new URL(request.url ?? "/", "http://localhost");
  if (url.pathname !== WORKSPACE_API_PATH && !url.pathname.startsWith(`${WORKSPACE_API_PATH}/`)) {
    return false;
  }

  const method = request.method ?? "GET";
  if (method === "OPTIONS") {
    // Every response carries the share API's CORS headers.
    sendEmpty(response, 204);
    return true;
  }

  try {
    const segment = url.pathname.slice(WORKSPACE_API_PATH.length).replace(/^\//, "");
    const parts = segment.split("/");
    if (parts.length !== 2 || parts[0]?.length === 0 || parts[1] !== "claim") {
      throw new HttpError(404, "Not found.");
    }

    const workspaceId = decodeSegment(parts[0] ?? "");
    if (method !== "POST") {
      methodNotAllowed(response, "POST, OPTIONS");
      return true;
    }
    await claim(request, response, registry, workspaceId);
  } catch (error) {
    if (response.headersSent) return true;
    if (error instanceof HttpError) {
      sendJson(response, error.status, { error: error.message });
      return true;
    }
    console.error("[workspaces] request failed", error);
    sendJson(response, 500, { error: "The workspace request failed." });
  }

  return true;
}
