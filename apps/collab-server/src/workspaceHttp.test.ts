import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { handleWorkspaceRequest } from "./workspaceHttp.js";
import { createWorkspaceRegistry, type WorkspaceRegistry } from "./workspaces.js";

let directory: string;
let registry: WorkspaceRegistry;
let server: Server;
let baseUrl: string;

beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), "suite-workspace-api-"));
  registry = createWorkspaceRegistry(join(directory, "workspaces.sqlite"));

  server = createServer((request, response) => {
    void handleWorkspaceRequest(request, response, registry).then((handled) => {
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
