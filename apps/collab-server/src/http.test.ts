import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { handleShareRequest } from "./http.js";
import { createShareStore, type ShareStore } from "./shares.js";

let directory: string;
let store: ShareStore;
let server: Server;
let baseUrl: string;
let changes: string[];
let hookError: boolean;

beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), "suite-share-api-"));
  store = createShareStore(join(directory, "shares.sqlite"));
  changes = [];
  hookError = false;

  server = createServer((request, response) => {
    void handleShareRequest(request, response, store, {
      onSharesChanged: (workspaceId) => {
        changes.push(workspaceId);
        if (hookError) throw new Error("projection hook failed");
      },
    }).then((handled) => {
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
  store.close();
  rmSync(directory, { recursive: true, force: true });
});

function post(body: unknown): Promise<Response> {
  return fetch(`${baseUrl}/api/shares`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("share API", () => {
  it("creates, lists, resolves and revokes a workspace share", async () => {
    const created = await post({ workspaceId: "ws-1", scope: "workspace", role: "editor" });
    expect(created.status).toBe(201);
    const { token, share } = (await created.json()) as {
      token: string;
      share: { id: string; roomId: string; role: string };
    };
    expect(token.length).toBeGreaterThanOrEqual(32);
    expect(share.roomId).toBe("ws-1");
    expect(share.role).toBe("editor");

    const listed = await fetch(`${baseUrl}/api/shares?workspaceId=ws-1`);
    expect(listed.status).toBe(200);
    const listBody = (await listed.json()) as { shares: { id: string }[] };
    expect(listBody.shares.map((entry) => entry.id)).toEqual([share.id]);

    const resolved = await fetch(`${baseUrl}/api/shares/${token}`);
    expect(resolved.status).toBe(200);
    const resolveBody = (await resolved.json()) as { share: { id: string; roomId: string } };
    expect(resolveBody.share.id).toBe(share.id);
    expect(resolveBody.share.roomId).toBe("ws-1");

    const revoked = await fetch(`${baseUrl}/api/shares/${share.id}`, { method: "DELETE" });
    expect(revoked.status).toBe(200);
    const revokeBody = (await revoked.json()) as { share: { revokedAt: number | null } };
    expect(revokeBody.share.revokedAt).toBeTypeOf("number");

    expect((await fetch(`${baseUrl}/api/shares/${token}`)).status).toBe(404);
    const empty = (await (await fetch(`${baseUrl}/api/shares?workspaceId=ws-1`)).json()) as {
      shares: unknown[];
    };
    expect(empty.shares).toHaveLength(0);
  });

  it("returns the projection room for board and card viewers", async () => {
    const board = await post({
      workspaceId: "ws-1",
      scope: "board",
      role: "viewer",
      boardId: "board-1",
    });
    expect(board.status).toBe(201);
    const boardBody = (await board.json()) as { token: string; share: { roomId: string } };
    expect(boardBody.share.roomId).toBe(`share-${boardBody.token}`);

    const card = await post({
      workspaceId: "ws-1",
      scope: "card",
      role: "viewer",
      boardId: "board-1",
      cardId: "card-1",
    });
    expect(card.status).toBe(201);
    const cardBody = (await card.json()) as { token: string; share: { roomId: string } };
    expect(cardBody.share.roomId).toBe(`share-${cardBody.token}`);
  });

  it("never reveals the owner workspace id to a board or card viewer", async () => {
    const created = await post({
      workspaceId: "ws-secret",
      scope: "board",
      role: "viewer",
      boardId: "board-1",
    });
    const { token } = (await created.json()) as { token: string };

    const resolved = await fetch(`${baseUrl}/api/shares/${token}`);
    expect(resolved.status).toBe(200);
    const body = (await resolved.json()) as {
      share: { workspaceId: string; roomId: string; scope: string };
    };

    expect(body.share.scope).toBe("board");
    expect(body.share.workspaceId).toBe(`share-${token}`);
    expect(body.share.roomId).toBe(`share-${token}`);
    expect(JSON.stringify(body)).not.toContain("ws-secret");

    // A viewer cannot mint a workspace share, even from the projection id.
    const minted = await post({
      workspaceId: body.share.workspaceId,
      scope: "workspace",
      role: "viewer",
    });
    expect(minted.status).toBe(400);
    expect(((await minted.json()) as { error: string }).error).toBe(
      "Workspace viewer links are coming next.",
    );
  });

  it("keeps the workspace id for a workspace share and redacts a revoked card share", async () => {
    const workspace = await post({ workspaceId: "ws-owner", scope: "workspace", role: "editor" });
    const { token: workspaceToken } = (await workspace.json()) as { token: string };

    const resolved = await fetch(`${baseUrl}/api/shares/${workspaceToken}`);
    const resolvedBody = (await resolved.json()) as {
      share: { workspaceId: string; roomId: string };
    };
    expect(resolvedBody.share.workspaceId).toBe("ws-owner");
    expect(resolvedBody.share.roomId).toBe("ws-owner");

    const card = await post({
      workspaceId: "ws-owner",
      scope: "card",
      role: "viewer",
      cardId: "card-9",
    });
    const created = (await card.json()) as { token: string; share: { id: string } };
    const revoked = await fetch(`${baseUrl}/api/shares/${created.share.id}`, { method: "DELETE" });
    expect(revoked.status).toBe(200);
    const body = (await revoked.json()) as { share: { workspaceId: string } };
    expect(body.share.workspaceId).toBe(`share-${created.token}`);
    expect(JSON.stringify(body)).not.toContain("ws-owner");
  });

  it("notifies the projection hook when a share is created or revoked", async () => {
    const created = await post({
      workspaceId: "ws-1",
      scope: "board",
      role: "viewer",
      boardId: "b",
    });
    expect(created.status).toBe(201);
    const { share } = (await created.json()) as { share: { id: string } };
    expect(changes).toEqual(["ws-1"]);

    await fetch(`${baseUrl}/api/shares/${share.id}`, { method: "DELETE" });
    expect(changes).toEqual(["ws-1", "ws-1"]);
  });

  it("keeps the response when the projection hook throws", async () => {
    hookError = true;
    const created = await post({ workspaceId: "ws-1", scope: "card", role: "viewer", cardId: "c" });

    expect(created.status).toBe(201);
    expect(changes).toEqual(["ws-1"]);
  });

  it("answers CORS preflight and marks every response", async () => {
    const preflight = await fetch(`${baseUrl}/api/shares`, { method: "OPTIONS" });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-origin")).toBe("*");
    expect(preflight.headers.get("access-control-allow-methods")).toContain("DELETE");
    expect(preflight.headers.get("access-control-allow-headers")).toBe("content-type");

    const created = await post({ workspaceId: "ws-1", scope: "workspace", role: "editor" });
    expect(created.headers.get("access-control-allow-origin")).toBe("*");
  });

  it("rejects invalid payloads with a message", async () => {
    const missingWorkspace = await post({ scope: "workspace", role: "viewer" });
    expect(missingWorkspace.status).toBe(400);
    expect(((await missingWorkspace.json()) as { error: string }).error).toContain("workspace id");

    const badScope = await post({ workspaceId: "ws-1", scope: "folder", role: "viewer" });
    expect(badScope.status).toBe(400);

    const badRole = await post({ workspaceId: "ws-1", scope: "workspace", role: "owner" });
    expect(badRole.status).toBe(400);

    const missingBoard = await post({ workspaceId: "ws-1", scope: "board", role: "viewer" });
    expect(missingBoard.status).toBe(400);

    const missingCard = await post({ workspaceId: "ws-1", scope: "card", role: "viewer" });
    expect(missingCard.status).toBe(400);

    const strayTarget = await post({
      workspaceId: "ws-1",
      scope: "workspace",
      role: "viewer",
      boardId: "board-1",
    });
    expect(strayTarget.status).toBe(400);
  });

  it("defers workspace viewer links until management has a credential", async () => {
    const created = await post({ workspaceId: "ws-1", scope: "workspace", role: "viewer" });

    expect(created.status).toBe(400);
    expect(((await created.json()) as { error: string }).error).toBe(
      "Workspace viewer links are coming next.",
    );
  });

  it("defers board and card editor links", async () => {
    const boardEditor = await post({
      workspaceId: "ws-1",
      scope: "board",
      role: "editor",
      boardId: "board-1",
    });
    expect(boardEditor.status).toBe(400);
    expect(((await boardEditor.json()) as { error: string }).error).toBe(
      "Board and card editor links are coming next.",
    );

    const cardEditor = await post({
      workspaceId: "ws-1",
      scope: "card",
      role: "editor",
      cardId: "card-1",
    });
    expect(cardEditor.status).toBe(400);

    const workspaceEditor = await post({ workspaceId: "ws-1", scope: "workspace", role: "editor" });
    expect(workspaceEditor.status).toBe(201);
  });

  it("rejects malformed bodies", async () => {
    const invalidJson = await post("{ not json");
    expect(invalidJson.status).toBe(400);
    expect(((await invalidJson.json()) as { error: string }).error).toContain("valid JSON");

    const empty = await post("");
    expect(empty.status).toBe(400);

    const array = await post([1, 2, 3]);
    expect(array.status).toBe(400);

    const tooLarge = await post(
      JSON.stringify({ workspaceId: "x".repeat(70 * 1024), scope: "workspace", role: "viewer" }),
    );
    expect(tooLarge.status).toBe(413);
  });

  it("returns 404 for unknown shares and routes", async () => {
    expect((await fetch(`${baseUrl}/api/shares/unknown-token`)).status).toBe(404);
    expect((await fetch(`${baseUrl}/api/shares/missing`, { method: "DELETE" })).status).toBe(404);
    expect((await fetch(`${baseUrl}/api/shares/a/b`)).status).toBe(404);
    expect((await fetch(`${baseUrl}/api/shares`)).status).toBe(400);
  });

  it("rejects unsupported methods", async () => {
    const put = await fetch(`${baseUrl}/api/shares`, { method: "PUT" });
    expect(put.status).toBe(405);
    expect(put.headers.get("allow")).toBe("GET, POST, OPTIONS");

    const patch = await fetch(`${baseUrl}/api/shares/some-id`, { method: "PATCH" });
    expect(patch.status).toBe(405);
  });

  it("leaves non-API routes to the caller", async () => {
    const response = await fetch(`${baseUrl}/health`);
    expect(response.status).toBe(404);
  });
});
