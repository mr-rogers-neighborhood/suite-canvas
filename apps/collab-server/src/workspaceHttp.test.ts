import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetRateLimits } from "./rateLimit.js";
import { handleWorkspaceRequest } from "./workspaceHttp.js";
import { createWorkspaceRegistry, type WorkspaceRegistry } from "./workspaces.js";

let directory: string;
let registry: WorkspaceRegistry;
let server: Server;
let baseUrl: string;
let rotations: [string, string][];

beforeEach(async () => {
  resetRateLimits();
  rotations = [];
  directory = mkdtempSync(join(tmpdir(), "suite-workspace-api-"));
  registry = createWorkspaceRegistry(join(directory, "workspaces.sqlite"));

  server = createServer((request, response) => {
    const hooks = {
      onRotated: (workspaceId: string, previousOwnerKey: string) => {
        rotations.push([workspaceId, previousOwnerKey]);
      },
    };
    void handleWorkspaceRequest(request, response, registry, hooks).then((handled) => {
      if (handled) return;
      response.writeHead(404, { "content-type": "text/plain" });
      response.end("not found");
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("expected a TCP address");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  registry.close();
  rmSync(directory, { recursive: true, force: true });
});

function claim(workspaceId: string, body: unknown): Promise<Response> {
  return fetch(`${baseUrl}/api/workspaces/${encodeURIComponent(workspaceId)}/claim`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function rotate(workspaceId: string, currentKey: string | null, body: unknown): Promise<Response> {
  return fetch(`${baseUrl}/api/workspaces/${encodeURIComponent(workspaceId)}/rotate`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(currentKey === null ? {} : { authorization: `Bearer ${currentKey}` }),
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("workspace claim API", () => {
  it("claims a workspace and accepts the same key again", async () => {
    const first = await claim("ws-1", { ownerKey: "owner-key-1" });
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ workspaceId: "ws-1", claimed: true });

    const again = await claim("ws-1", { ownerKey: "owner-key-1" });
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual({ workspaceId: "ws-1", claimed: true });
  });

  it("rejects a different key with a readable conflict", async () => {
    await claim("ws-1", { ownerKey: "owner-key-1" });
    const conflict = await claim("ws-1", { ownerKey: "owner-key-2" });

    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toEqual({
      error: "This workspace is protected by a different owner key.",
    });
    expect(registry.verify("ws-1", "owner-key-1")).toBe(true);
  });

  it("rejects malformed bodies and identifiers", async () => {
    const missing = await claim("ws-1", {});
    expect(missing.status).toBe(400);

    const empty = await claim("ws-1", { ownerKey: "   " });
    expect(empty.status).toBe(400);

    const notJson = await claim("ws-1", "{not json");
    expect(notJson.status).toBe(400);

    const array = await claim("ws-1", []);
    expect(array.status).toBe(400);

    const noBody = await fetch(`${baseUrl}/api/workspaces/ws-1/claim`, { method: "POST" });
    expect(noBody.status).toBe(400);
  });

  it("answers CORS preflight and marks every response", async () => {
    const preflight = await fetch(`${baseUrl}/api/workspaces/ws-1/claim`, { method: "OPTIONS" });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-origin")).toBe("*");
    expect(preflight.headers.get("access-control-allow-headers")).toContain("content-type");

    const claimed = await claim("ws-1", { ownerKey: "owner-key-1" });
    expect(claimed.headers.get("access-control-allow-origin")).toBe("*");
  });

  it("rejects unsupported methods and unknown routes", async () => {
    const wrongMethod = await fetch(`${baseUrl}/api/workspaces/ws-1/claim`);
    expect(wrongMethod.status).toBe(405);
    expect(wrongMethod.headers.get("allow")).toBe("POST, OPTIONS");

    const unknown = await fetch(`${baseUrl}/api/workspaces/ws-1`);
    expect(unknown.status).toBe(404);

    const malformed = await fetch(`${baseUrl}/api/workspaces/%E0%A4%A/claim`, { method: "POST" });
    expect(malformed.status).toBe(400);
  });

  it("leaves non-API routes to the caller", async () => {
    const response = await fetch(`${baseUrl}/health`);
    expect(response.status).toBe(404);
    expect(await response.text()).toBe("not found");
  });
});

describe("workspace rotate API", () => {
  it("reports the previous owner key to the rotation hook", async () => {
    await claim("ws-1", { ownerKey: "owner-key-1" });
    const rotated = await rotate("ws-1", "owner-key-1", { newOwnerKey: "owner-key-2" });
    expect(rotated.status).toBe(200);
    expect(rotations).toEqual([["ws-1", "owner-key-1"]]);
  });

  it("does not report a rejected rotation", async () => {
    await claim("ws-1", { ownerKey: "owner-key-1" });
    const denied = await rotate("ws-1", "owner-key-9", { newOwnerKey: "owner-key-2" });
    expect(denied.status).toBe(403);
    expect(rotations).toEqual([]);
  });

  it("rotates with the current key and accepts only the new one afterwards", async () => {
    await claim("ws-1", { ownerKey: "owner-key-1" });

    const rotated = await rotate("ws-1", "owner-key-1", { newOwnerKey: "owner-key-2" });
    expect(rotated.status).toBe(200);
    expect(await rotated.json()).toEqual({ workspaceId: "ws-1", rotated: true });
    expect(registry.verify("ws-1", "owner-key-2")).toBe(true);
    expect(registry.verify("ws-1", "owner-key-1")).toBe(false);

    // The old editor link fails; the new key works.
    const stale = await claim("ws-1", { ownerKey: "owner-key-1" });
    expect(stale.status).toBe(409);
    const fresh = await claim("ws-1", { ownerKey: "owner-key-2" });
    expect(fresh.status).toBe(200);
  });

  it("requires the current key in the Authorization header", async () => {
    await claim("ws-1", { ownerKey: "owner-key-1" });

    const missing = await rotate("ws-1", null, { newOwnerKey: "owner-key-2" });
    expect(missing.status).toBe(401);

    const blank = await rotate("ws-1", "   ", { newOwnerKey: "owner-key-2" });
    expect(blank.status).toBe(401);

    const bare = await fetch(`${baseUrl}/api/workspaces/ws-1/rotate`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "owner-key-1" },
      body: JSON.stringify({ newOwnerKey: "owner-key-2" }),
    });
    expect(bare.status).toBe(401);

    // A refused rotation leaves the original key in place.
    expect(registry.verify("ws-1", "owner-key-1")).toBe(true);
  });

  it("refuses a different current key with 403", async () => {
    await claim("ws-1", { ownerKey: "owner-key-1" });

    const denied = await rotate("ws-1", "owner-key-9", { newOwnerKey: "owner-key-2" });
    expect(denied.status).toBe(403);
    expect(await denied.json()).toEqual({
      error: "The current owner key does not match this workspace.",
    });
    expect(registry.verify("ws-1", "owner-key-1")).toBe(true);
  });

  it("refuses to rotate a workspace that has no owner", async () => {
    const unknown = await rotate("ws-unknown", "owner-key-1", { newOwnerKey: "owner-key-2" });
    expect(unknown.status).toBe(403);
    expect(registry.has("ws-unknown")).toBe(false);
  });

  it("rejects malformed rotation bodies", async () => {
    await claim("ws-1", { ownerKey: "owner-key-1" });

    const missing = await rotate("ws-1", "owner-key-1", {});
    expect(missing.status).toBe(400);

    const blank = await rotate("ws-1", "owner-key-1", { newOwnerKey: "  " });
    expect(blank.status).toBe(400);

    const array = await rotate("ws-1", "owner-key-1", []);
    expect(array.status).toBe(400);

    const notJson = await rotate("ws-1", "owner-key-1", "{not json");
    expect(notJson.status).toBe(400);

    expect(registry.verify("ws-1", "owner-key-1")).toBe(true);
  });

  it("answers CORS preflight and rejects other methods", async () => {
    const preflight = await fetch(`${baseUrl}/api/workspaces/ws-1/rotate`, { method: "OPTIONS" });
    expect(preflight.status).toBe(204);

    const wrongMethod = await fetch(`${baseUrl}/api/workspaces/ws-1/rotate`);
    expect(wrongMethod.status).toBe(405);
    expect(wrongMethod.headers.get("allow")).toBe("POST, OPTIONS");
  });
});

describe("workspace API limits", () => {
  it("rate-limits ownership claims per address", async () => {
    for (let index = 0; index < 600; index += 1) {
      const response = await claim(`ws-limit-${index}`, { ownerKey: `key-${index}` });
      expect(response.status).toBe(200);
    }
    const limited = await claim("ws-limit-final", { ownerKey: "key-final" });
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBeTruthy();
  });
});
