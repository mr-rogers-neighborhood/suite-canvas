import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleShareRequest } from "./http.js";
import type { SharePublishResult } from "./projectionWorker.js";
import { resetRateLimits } from "./rateLimit.js";
import { createShareStore, type Share, type ShareStore } from "./shares.js";
import { createWorkspaceRegistry, type WorkspaceRegistry } from "./workspaces.js";

const OWNER_KEY = "owner-key-1";
const OTHER_KEY = "owner-key-2";
const MANAGED_WORKSPACES = ["ws-1", "ws-owner", "ws-secret"];

let directory: string;
let store: ShareStore;
let workspaces: WorkspaceRegistry;
let server: Server;
let baseUrl: string;
let changes: string[];
let removed: Share[];
let hookError: boolean;
let publishResult: SharePublishResult;
let reloadResult: SharePublishResult;
let published: Share[];
let publishedVersions: (Record<string, number> | undefined)[];
let publishedOverwrites: (readonly string[] | undefined)[];
let statuses: Share[];
let statusResult: { dirty: boolean; hasBaseline: boolean };
let reloaded: Share[];
let flushes: string[];
/** Holds the create request inside its forced save until the test releases it. */
let flushGate: Promise<void> | null;
let flushError: boolean;
let order: string[];

beforeEach(async () => {
  resetRateLimits();
  directory = mkdtempSync(join(tmpdir(), "suite-share-api-"));
  store = createShareStore(join(directory, "shares.sqlite"));
  workspaces = createWorkspaceRegistry(join(directory, "workspaces.sqlite"));
  for (const workspaceId of MANAGED_WORKSPACES) workspaces.claimOrVerify(workspaceId, OWNER_KEY);
  changes = [];
  removed = [];
  hookError = false;
  publishResult = { ok: true, applied: 1 };
  reloadResult = { ok: true, applied: 0 };
  published = [];
  publishedVersions = [];
  publishedOverwrites = [];
  statuses = [];
  statusResult = { dirty: true, hasBaseline: true };
  reloaded = [];
  flushes = [];
  flushGate = null;
  flushError = false;
  order = [];

  server = createServer((request, response) => {
    void handleShareRequest(request, response, store, workspaces, {
      flush: async (workspaceId) => {
        flushes.push(workspaceId);
        order.push(`flush:${workspaceId}`);
        if (flushGate) await flushGate;
        if (flushError) throw new Error("save failed");
      },
      onSharesChanged: (workspaceId) => {
        changes.push(workspaceId);
        order.push(`changed:${workspaceId}`);
        if (hookError) throw new Error("projection hook failed");
      },
      onShareRemoved: (share) => {
        removed.push(share);
      },
      publish: (share, version, overwrite) => {
        published.push(share);
        publishedVersions.push(version);
        publishedOverwrites.push(overwrite);
        return publishResult;
      },
      status: (share) => {
        statuses.push(share);
        return statusResult;
      },
      reload: (share) => {
        reloaded.push(share);
        return reloadResult;
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
  vi.unstubAllEnvs();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  store.close();
  workspaces.close();
  rmSync(directory, { recursive: true, force: true });
});

const owner = { authorization: `Bearer ${OWNER_KEY}` };

function post(body: unknown, headers: Record<string, string> = owner): Promise<Response> {
  return fetch(`${baseUrl}/api/shares`, {
    method: "POST",
    headers: { ...headers, "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function list(workspaceId: string, headers: Record<string, string> = owner): Promise<Response> {
  return fetch(`${baseUrl}/api/shares?workspaceId=${encodeURIComponent(workspaceId)}`, { headers });
}

function revoke(id: string, headers: Record<string, string> = owner): Promise<Response> {
  return fetch(`${baseUrl}/api/shares/${id}`, { method: "DELETE", headers });
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

    const listed = await list("ws-1");
    expect(listed.status).toBe(200);
    const listBody = (await listed.json()) as { shares: { id: string }[] };
    expect(listBody.shares.map((entry) => entry.id)).toEqual([share.id]);

    // Resolving a token is public: the recipient holds the token, not the key.
    const resolved = await fetch(`${baseUrl}/api/shares/${token}`);
    expect(resolved.status).toBe(200);
    const resolveBody = (await resolved.json()) as { share: { id: string; roomId: string } };
    expect(resolveBody.share.id).toBe(share.id);
    expect(resolveBody.share.roomId).toBe("ws-1");

    const revoked = await revoke(share.id);
    expect(revoked.status).toBe(200);
    const revokeBody = (await revoked.json()) as { share: { revokedAt: number | null } };
    expect(revokeBody.share.revokedAt).toBeTypeOf("number");

    expect((await fetch(`${baseUrl}/api/shares/${token}`)).status).toBe(404);
    const empty = (await (await list("ws-1")).json()) as { shares: unknown[] };
    expect(empty.shares).toHaveLength(0);
  });

  it("requires the owner key for management", async () => {
    const body = { workspaceId: "ws-1", scope: "workspace", role: "viewer" };

    const missing = await post(body, {});
    expect(missing.status).toBe(401);
    expect(((await missing.json()) as { error: string }).error).toContain("owner key");

    const wrong = await post(body, { authorization: `Bearer ${OTHER_KEY}` });
    expect(wrong.status).toBe(403);
    expect(((await wrong.json()) as { error: string }).error).toContain("different owner key");

    const created = await post(body);
    expect(created.status).toBe(201);

    expect((await list("ws-1", {})).status).toBe(401);
    expect((await list("ws-1", { authorization: `Bearer ${OTHER_KEY}` })).status).toBe(403);
    expect((await list("ws-1")).status).toBe(200);

    const { share } = (await created.json()) as { share: { id: string } };
    expect((await revoke(share.id, {})).status).toBe(401);
    expect((await revoke(share.id, { authorization: `Bearer ${OTHER_KEY}` })).status).toBe(403);
    expect((await revoke(share.id)).status).toBe(200);
  });

  it("accepts x-suite-owner as an owner key fallback", async () => {
    const created = await post(
      { workspaceId: "ws-1", scope: "workspace", role: "viewer" },
      { "x-suite-owner": OWNER_KEY },
    );

    expect(created.status).toBe(201);
    expect((await list("ws-1", { "x-suite-owner": OWNER_KEY })).status).toBe(200);
  });

  it("never accepts a share token as a management credential", async () => {
    const created = await post({ workspaceId: "ws-1", scope: "workspace", role: "editor" });
    const { token, share } = (await created.json()) as {
      token: string;
      share: { id: string };
    };
    const asShareToken = { authorization: `Bearer ${token}` };

    const minted = await post(
      { workspaceId: "ws-1", scope: "workspace", role: "viewer" },
      asShareToken,
    );
    expect(minted.status).toBe(403);

    expect((await list("ws-1", asShareToken)).status).toBe(403);
    expect((await revoke(share.id, asShareToken)).status).toBe(403);
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

  it("creates a selection link without leaking its card ids to the holder", async () => {
    const created = await post({
      workspaceId: "ws-1",
      scope: "selection",
      role: "viewer",
      boardId: "board-1",
      cardIds: ["card-2", "card-1", "card-2"],
    });
    expect(created.status).toBe(201);
    const body = (await created.json()) as {
      token: string;
      share: { roomId: string; cardIds: string[]; cardCount: number };
    };

    expect(body.share.roomId).toBe(`share-${body.token}`);
    expect(body.share.cardIds).toEqual([]);
    expect(body.share.cardCount).toBe(2);

    const resolved = await fetch(`${baseUrl}/api/shares/${body.token}`);
    expect(resolved.status).toBe(200);
    const resolvedBody = (await resolved.json()) as {
      share: { cardIds: string[]; cardCount: number; scope: string };
    };
    expect(resolvedBody.share.scope).toBe("selection");
    expect(resolvedBody.share.cardIds).toEqual([]);
    expect(resolvedBody.share.cardCount).toBe(2);

    // The owner listing keeps the ids: only the link holder loses them.
    const listed = (await (await list("ws-1")).json()) as {
      shares: { cardIds: string[]; cardCount: number }[];
    };
    expect(listed.shares[0]?.cardIds).toEqual(["card-2", "card-1"]);
    expect(listed.shares[0]?.cardCount).toBe(2);
  });

  it("rejects an editor selection link", async () => {
    const response = await post({
      workspaceId: "ws-1",
      scope: "selection",
      role: "editor",
      boardId: "board-1",
      cardIds: ["card-1"],
    });

    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: string }).error).toContain("read-only");
  });

  it("refuses to publish or report status for a selection link", async () => {
    const created = await post({
      workspaceId: "ws-1",
      scope: "selection",
      role: "viewer",
      boardId: "board-1",
      cardIds: ["card-1"],
    });
    const { token } = (await created.json()) as { token: string };
    const headers = { authorization: ["Bearer", token].join(" ") };

    const publish = await fetch(`${baseUrl}/api/shares/${token}/publish`, {
      method: "POST",
      headers,
    });
    expect(publish.status).toBe(403);
    expect(((await publish.json()) as { error: string }).error).toContain("editor");

    const status = await fetch(`${baseUrl}/api/shares/${token}/status`, { headers });
    expect(status.status).toBe(403);
    expect(((await status.json()) as { error: string }).error).toContain("editor");

    expect(published).toHaveLength(0);
    expect(statuses).toHaveLength(0);
  });

  it("creates a workspace viewer link", async () => {
    const created = await post({ workspaceId: "ws-1", scope: "workspace", role: "viewer" });

    expect(created.status).toBe(201);
    const { share } = (await created.json()) as { share: { role: string; roomId: string } };
    expect(share.role).toBe("viewer");
    expect(share.roomId).toBe("ws-1");

    const listed = (await (await list("ws-1")).json()) as { shares: { role: string }[] };
    expect(listed.shares.map((entry) => entry.role)).toEqual(["viewer"]);
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

    // The token is not a management credential either.
    expect(
      (
        await post(
          { workspaceId: body.share.workspaceId, scope: "workspace", role: "viewer" },
          {
            authorization: `Bearer ${token}`,
          },
        )
      ).status,
    ).toBe(403);
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
    const revoked = await revoke(created.share.id);
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

    await revoke(share.id);
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
    expect(preflight.headers.get("access-control-allow-headers")).toContain("content-type");
    expect(preflight.headers.get("access-control-allow-headers")).toContain("authorization");

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

  it("creates board and card editor links", async () => {
    const boardEditor = await post({
      workspaceId: "ws-1",
      scope: "board",
      role: "editor",
      boardId: "board-1",
    });
    expect(boardEditor.status).toBe(201);
    const board = (await boardEditor.json()) as { token: string; share: { role: string } };
    expect(board.share.role).toBe("editor");
    expect(board.token.length).toBeGreaterThanOrEqual(32);

    const cardEditor = await post({
      workspaceId: "ws-1",
      scope: "card",
      role: "editor",
      cardId: "card-1",
    });
    expect(cardEditor.status).toBe(201);
    const card = (await cardEditor.json()) as { share: { role: string } };
    expect(card.share.role).toBe("editor");

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
    expect((await revoke("missing")).status).toBe(404);
    expect((await fetch(`${baseUrl}/api/shares/a/b`)).status).toBe(404);
    expect((await fetch(`${baseUrl}/api/shares`)).status).toBe(400);
  });

  it("rejects unsupported methods", async () => {
    const put = await fetch(`${baseUrl}/api/shares`, { method: "PUT" });
    expect(put.status).toBe(405);
    expect(put.headers.get("allow")).toBe("GET, POST, DELETE, OPTIONS");

    const patch = await fetch(`${baseUrl}/api/shares/some-id`, { method: "PATCH" });
    expect(patch.status).toBe(405);
  });

  it("leaves non-API routes to the caller", async () => {
    const response = await fetch(`${baseUrl}/health`);
    expect(response.status).toBe(404);
  });
});

describe("publish and reload API", () => {
  async function share(body: Record<string, unknown>): Promise<{ token: string; id: string }> {
    const response = await post(body);
    if (response.status !== 201) throw new Error(`create failed: ${response.status}`);
    const created = (await response.json()) as { token: string; share: { id: string } };
    return { token: created.token, id: created.share.id };
  }

  function draft(
    action: "publish" | "reload" | "status",
    token: string,
    headers: Record<string, string> = {},
    body?: unknown,
  ): Promise<Response> {
    return fetch(`${baseUrl}/api/shares/${token}/${action}`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  }

  function status(token: string, headers?: Record<string, string>): Promise<Response> {
    return fetch(`${baseUrl}/api/shares/${token}/status`, {
      headers: headers ?? { authorization: ["Bearer", token].join(" ") },
    });
  }

  it("publishes with the editor token and reports the applied count", async () => {
    const editor = await share({
      workspaceId: "ws-1",
      scope: "board",
      role: "editor",
      boardId: "board-1",
    });
    publishResult = { ok: true, applied: 4 };

    const response = await draft("publish", editor.token);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ applied: 4 });
    expect(published).toHaveLength(1);
    expect(published[0]?.id).toBe(editor.id);
  });

  it("returns the conflicts of a rejected publish", async () => {
    const editor = await share({
      workspaceId: "ws-1",
      scope: "card",
      role: "editor",
      cardId: "card-1",
    });
    publishResult = {
      ok: false,
      conflicts: [{ key: "card:card-1:body", kind: "body", message: "changed" }],
      unsupported: [],
      reason: "Resolve the conflicts first.",
    };

    const response = await draft("publish", editor.token);

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      conflicts: [{ key: "card:card-1:body", kind: "body", message: "changed" }],
      unsupported: [],
      reason: "Resolve the conflicts first.",
    });
  });

  it("reloads with an editor token", async () => {
    const editor = await share({
      workspaceId: "ws-1",
      scope: "board",
      role: "editor",
      boardId: "board-1",
    });
    reloadResult = { ok: true, applied: 2 };

    const response = await draft("reload", editor.token);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ applied: 2 });
    expect(reloaded[0]?.id).toBe(editor.id);
  });

  it("requires the share token", async () => {
    const editor = await share({
      workspaceId: "ws-1",
      scope: "board",
      role: "editor",
      boardId: "board-1",
    });

    const missing = await fetch(`${baseUrl}/api/shares/${editor.token}/publish`, {
      method: "POST",
    });
    expect(missing.status).toBe(401);

    const wrong = await draft("publish", editor.token, { authorization: "Bearer other-token" });
    expect(wrong.status).toBe(404);

    const other = await share({
      workspaceId: "ws-1",
      scope: "board",
      role: "editor",
      boardId: "board-1",
    });
    const crossed = await fetch(`${baseUrl}/api/shares/${editor.token}/publish`, {
      method: "POST",
      headers: { authorization: `Bearer ${other.token}` },
    });
    expect(crossed.status).toBe(404);
    expect(published).toHaveLength(0);
  });

  it("rejects viewers and workspace shares", async () => {
    const viewer = await share({
      workspaceId: "ws-1",
      scope: "board",
      role: "viewer",
      boardId: "board-1",
    });
    const viewerResponse = await draft("publish", viewer.token);
    expect(viewerResponse.status).toBe(403);
    expect(((await viewerResponse.json()) as { error: string }).error).toContain("editor");

    const workspace = await share({ workspaceId: "ws-1", scope: "workspace", role: "editor" });
    const workspaceResponse = await draft("publish", workspace.token);
    expect(workspaceResponse.status).toBe(403);
    expect(((await workspaceResponse.json()) as { error: string }).error).toContain("Workspace");

    expect(published).toHaveLength(0);
  });

  it("returns 404 for unknown and revoked tokens", async () => {
    expect((await draft("publish", "unknown-token")).status).toBe(404);

    const editor = await share({
      workspaceId: "ws-1",
      scope: "card",
      role: "editor",
      cardId: "card-1",
    });
    await revoke(editor.id);
    expect((await draft("publish", editor.token)).status).toBe(404);
  });

  it("keeps GET/DELETE routes and methods intact", async () => {
    const editor = await share({
      workspaceId: "ws-1",
      scope: "board",
      role: "editor",
      boardId: "board-1",
    });

    expect((await fetch(`${baseUrl}/api/shares/${editor.token}`)).status).toBe(200);
    expect((await revoke(editor.id)).status).toBe(200);

    const get = await fetch(`${baseUrl}/api/shares/${editor.token}/publish`);
    expect(get.status).toBe(405);
    expect(get.headers.get("allow")).toBe("POST, OPTIONS");

    const unknownAction = await fetch(`${baseUrl}/api/shares/${editor.token}/merge`, {
      method: "POST",
      headers: { authorization: `Bearer ${editor.token}` },
    });
    expect(unknownAction.status).toBe(404);
  });

  it("passes the editor's version to the worker", async () => {
    const editor = await share({
      workspaceId: "ws-1",
      scope: "board",
      role: "editor",
      boardId: "board-1",
    });

    const response = await draft("publish", editor.token, {}, { version: { "12": 7 } });

    expect(response.status).toBe(200);
    expect(publishedVersions).toEqual([{ "12": 7 }]);

    // A body with no version is still a valid publish.
    await draft("publish", editor.token, {}, {});
    expect(publishedVersions[1]).toBeUndefined();

    // Reload stays body-free and never sends a version.
    await draft("reload", editor.token);
    expect(publishedVersions).toHaveLength(2);
  });

  it("passes the overwrite list to the worker", async () => {
    const editor = await share({
      workspaceId: "ws-1",
      scope: "board",
      role: "editor",
      boardId: "board-1",
    });

    expect((await draft("publish", editor.token, {}, { overwrite: ["card:a:body"] })).status).toBe(
      200,
    );
    expect(publishedOverwrites).toEqual([["card:a:body"]]);

    // An empty list is a real decision: keep every workspace value.
    await draft("publish", editor.token, {}, { overwrite: [] });
    expect(publishedOverwrites[1]).toEqual([]);

    // Without the field the worker keeps the all-or-nothing policy.
    await draft("publish", editor.token, {}, {});
    expect(publishedOverwrites[2]).toBeUndefined();
  });

  it("rejects a malformed overwrite list", async () => {
    const editor = await share({
      workspaceId: "ws-1",
      scope: "board",
      role: "editor",
      boardId: "board-1",
    });

    for (const body of [
      { overwrite: "card:a:body" },
      { overwrite: { key: "card:a:body" } },
      { overwrite: [1] },
      { overwrite: [""] },
      { overwrite: ["   "] },
    ]) {
      const response = await draft("publish", editor.token, {}, body);
      expect(response.status).toBe(400);
    }
    expect(published).toHaveLength(0);
  });

  it("reports the draft status to an editor token", async () => {
    const editor = await share({
      workspaceId: "ws-1",
      scope: "card",
      role: "editor",
      cardId: "card-1",
    });

    const response = await status(editor.token);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ dirty: true, hasBaseline: true });
    expect(statuses[0]?.id).toBe(editor.id);

    statusResult = { dirty: false, hasBaseline: false };
    expect(await (await status(editor.token)).json()).toEqual({
      dirty: false,
      hasBaseline: false,
    });
  });

  it("authenticates the status route", async () => {
    const editor = await share({
      workspaceId: "ws-1",
      scope: "board",
      role: "editor",
      boardId: "board-1",
    });

    const missing = await fetch(`${baseUrl}/api/shares/${editor.token}/status`);
    expect(missing.status).toBe(401);

    expect((await status("unknown-token")).status).toBe(404);

    const viewer = await share({
      workspaceId: "ws-1",
      scope: "board",
      role: "viewer",
      boardId: "board-1",
    });
    expect((await status(viewer.token)).status).toBe(403);

    const workspace = await share({ workspaceId: "ws-1", scope: "workspace", role: "editor" });
    expect((await status(workspace.token)).status).toBe(403);

    const revoked = await share({
      workspaceId: "ws-1",
      scope: "card",
      role: "editor",
      cardId: "card-1",
    });
    await revoke(revoked.id);
    expect((await status(revoked.token)).status).toBe(404);

    expect(statuses).toHaveLength(0);
  });

  it("answers status preflight and rejects other methods", async () => {
    const editor = await share({
      workspaceId: "ws-1",
      scope: "board",
      role: "editor",
      boardId: "board-1",
    });

    const preflight = await fetch(`${baseUrl}/api/shares/${editor.token}/status`, {
      method: "OPTIONS",
    });
    expect(preflight.status).toBe(204);

    const post = await draft("status", editor.token);
    expect(post.status).toBe(405);
    expect(post.headers.get("allow")).toBe("GET, OPTIONS");
  });

  it("rejects a malformed version", async () => {
    const editor = await share({
      workspaceId: "ws-1",
      scope: "board",
      role: "editor",
      boardId: "board-1",
    });

    for (const body of [
      { version: "abc" },
      { version: ["1"] },
      { version: { "1": -1 } },
      { version: { "1": 1.5 } },
      { version: { "1": "2" } },
      [1, 2],
      "text",
    ]) {
      const response = await draft("publish", editor.token, {}, body);
      expect(response.status).toBe(400);
    }
    expect(published).toHaveLength(0);
  });

  it("answers publish preflight", async () => {
    const editor = await share({
      workspaceId: "ws-1",
      scope: "board",
      role: "editor",
      boardId: "board-1",
    });
    const response = await fetch(`${baseUrl}/api/shares/${editor.token}/publish`, {
      method: "OPTIONS",
    });
    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-methods")).toContain("POST");
  });
});

describe("share API limits", () => {
  it("rate-limits share creation per workspace", async () => {
    for (let index = 0; index < 30; index += 1) {
      const response = await post({ workspaceId: "ws-1", scope: "workspace", role: "viewer" });
      expect(response.status).toBe(201);
    }
    const limited = await post({ workspaceId: "ws-1", scope: "workspace", role: "viewer" });
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBeTruthy();
  });

  it("refuses to create more than 100 active links", async () => {
    for (let index = 0; index < 100; index += 1) {
      store.create({ workspaceId: "ws-1", scope: "workspace", role: "viewer" });
    }
    const response = await post({ workspaceId: "ws-1", scope: "workspace", role: "viewer" });
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ error: expect.stringContaining("100") });
  });
});

describe("CORS allowlist", () => {
  it("echoes a configured origin and omits an unknown one", async () => {
    const previous = process.env.SUITE_ALLOWED_ORIGINS;
    process.env.SUITE_ALLOWED_ORIGINS = "https://app.example.com";
    try {
      const allowed = await fetch(`${baseUrl}/api/shares/missing`, {
        headers: { origin: "https://app.example.com" },
      });
      expect(allowed.headers.get("access-control-allow-origin")).toBe("https://app.example.com");

      const blocked = await fetch(`${baseUrl}/api/shares/missing`, {
        headers: { origin: "https://evil.example.com" },
      });
      expect(blocked.headers.get("access-control-allow-origin")).toBeNull();
    } finally {
      if (previous === undefined) delete process.env.SUITE_ALLOWED_ORIGINS;
      else process.env.SUITE_ALLOWED_ORIGINS = previous;
    }
  });
});

describe("bulk revoke", () => {
  it("revokes every active link in a workspace", async () => {
    await post({ workspaceId: "ws-1", scope: "workspace", role: "viewer" });
    await post({ workspaceId: "ws-1", scope: "board", role: "editor", boardId: "b-1" });

    const response = await fetch(`${baseUrl}/api/shares?workspaceId=ws-1`, {
      method: "DELETE",
      headers: owner,
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { shares: { revokedAt: number | null }[] };
    expect(body.shares).toHaveLength(2);
    expect(body.shares.every((share) => share.revokedAt !== null)).toBe(true);
    expect(removed).toHaveLength(2);
    const listed = await list("ws-1");
    await expect(listed.json()).resolves.toEqual({ shares: [] });
  });

  it("requires the owner key for a bulk revoke", async () => {
    const response = await fetch(`${baseUrl}/api/shares?workspaceId=ws-1`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${OTHER_KEY}` },
    });
    expect(response.status).toBe(403);
  });
});

describe("share expiry", () => {
  it("stores a future expiry and rejects a past one", async () => {
    const expiresAt = Date.now() + 60_000;
    const created = await post({
      workspaceId: "ws-1",
      scope: "workspace",
      role: "viewer",
      expiresAt,
    });
    expect(created.status).toBe(201);
    const body = (await created.json()) as { share: { expiresAt: number | null } };
    expect(body.share.expiresAt).toBe(expiresAt);

    const past = await post({
      workspaceId: "ws-1",
      scope: "workspace",
      role: "viewer",
      expiresAt: Date.now() - 1,
    });
    expect(past.status).toBe(400);
  });
});

describe("share creation hygiene", () => {
  it("saves the workspace before it creates the link", async () => {
    let release: () => void = () => {};
    flushGate = new Promise<void>((resolve) => {
      release = resolve;
    });

    let settled = false;
    const pending = post({ workspaceId: "ws-1", scope: "board", role: "viewer", boardId: "b" })
      .then((response) => {
        settled = true;
        return response;
      })
      .catch(() => {
        settled = true;
        return null;
      });

    // The handler is parked in the save: nothing is created and no projection is
    // scheduled until the save reports back.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(flushes).toEqual(["ws-1"]);
    expect(settled).toBe(false);
    expect(changes).toEqual([]);

    release();
    const created = await pending;
    expect(created?.status).toBe(201);
    // The save finishes first, then the link exists, then the projection runs.
    expect(order).toEqual(["flush:ws-1", "changed:ws-1"]);
  });

  it("still creates the link when the forced save fails", async () => {
    flushError = true;

    const created = await post({
      workspaceId: "ws-1",
      scope: "board",
      role: "viewer",
      boardId: "b",
    });

    expect(created.status).toBe(201);
    expect(flushes).toEqual(["ws-1"]);
    expect(changes).toEqual(["ws-1"]);
  });

  it("defaults a hosted link to 30 days", async () => {
    vi.stubEnv("SUITE_HOSTED", "1");
    const before = Date.now();

    const created = await post({ workspaceId: "ws-1", scope: "workspace", role: "viewer" });
    expect(created.status).toBe(201);
    const body = (await created.json()) as { share: { expiresAt: number | null } };
    const thirtyDays = 30 * 24 * 60 * 60 * 1000;
    expect(body.share.expiresAt).toBeGreaterThanOrEqual(before + thirtyDays);
    expect(body.share.expiresAt).toBeLessThanOrEqual(Date.now() + thirtyDays);
  });

  it("lets an explicit expiry win over the hosted default", async () => {
    vi.stubEnv("SUITE_HOSTED", "1");
    const expiresAt = Date.now() + 7 * 24 * 60 * 60 * 1000;

    const created = await post({
      workspaceId: "ws-1",
      scope: "workspace",
      role: "viewer",
      expiresAt,
    });

    const body = (await created.json()) as { share: { expiresAt: number | null } };
    expect(body.share.expiresAt).toBe(expiresAt);
  });

  it("lets the owner choose Never on a hosted relay", async () => {
    vi.stubEnv("SUITE_HOSTED", "1");

    for (const expiresAt of [null, 0]) {
      const created = await post({
        workspaceId: "ws-1",
        scope: "workspace",
        role: "viewer",
        expiresAt,
      });
      expect(created.status).toBe(201);
      const body = (await created.json()) as { share: { expiresAt: number | null } };
      expect(body.share.expiresAt).toBeNull();
    }
  });

  it("keeps the no-expiry default on a self-host", async () => {
    const created = await post({ workspaceId: "ws-1", scope: "workspace", role: "viewer" });

    const body = (await created.json()) as { share: { expiresAt: number | null } };
    expect(body.share.expiresAt).toBeNull();
  });

  it("reports the create defaults the dialog preselects from", async () => {
    const selfHosted = await fetch(`${baseUrl}/api/shares/defaults`);
    expect(selfHosted.status).toBe(200);
    expect(await selfHosted.json()).toEqual({ hosted: false, defaultExpiryDays: 0 });

    vi.stubEnv("SUITE_HOSTED", "1");
    const hosted = await fetch(`${baseUrl}/api/shares/defaults`);
    expect(hosted.status).toBe(200);
    expect(await hosted.json()).toEqual({ hosted: true, defaultExpiryDays: 30 });

    const wrongMethod = await fetch(`${baseUrl}/api/shares/defaults`, { method: "POST" });
    expect(wrongMethod.status).toBe(405);
  });

  it("lists a last-used timestamp that a resolve sets and a listing keeps", async () => {
    const created = await post({
      workspaceId: "ws-1",
      scope: "board",
      role: "viewer",
      boardId: "b",
    });
    const { token, share } = (await created.json()) as {
      token: string;
      share: { id: string; lastUsedAt: number | null };
    };
    expect(share.lastUsedAt).toBeNull();

    await fetch(`${baseUrl}/api/shares/${token}`);
    const listed = (await (await list("ws-1")).json()) as {
      shares: { id: string; lastUsedAt: number | null }[];
    };
    const first = listed.shares.find((entry) => entry.id === share.id);
    expect(first?.lastUsedAt).toBeTypeOf("number");

    // Listing again does not count as a use.
    const again = (await (await list("ws-1")).json()) as {
      shares: { id: string; lastUsedAt: number | null }[];
    };
    expect(again.shares.find((entry) => entry.id === share.id)?.lastUsedAt).toBe(first?.lastUsedAt);
  });
});

describe("share session exchange", () => {
  /** Creates a board share through the API and returns what a recipient holds. */
  async function boardLink() {
    const created = await post({
      workspaceId: "ws-1",
      scope: "board",
      role: "viewer",
      boardId: "board-1",
    });
    expect(created.status).toBe(201);
    return (await created.json()) as {
      token: string;
      share: { id: string; roomId: string; workspaceId: string };
    };
  }

  function exchange(token: string, query = ""): Promise<Response> {
    return fetch(`${baseUrl}/api/shares/session${query}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token }),
    });
  }

  /** The cookie value a browser would send back. */
  function cookieOf(response: Response): string {
    const header = response.headers.getSetCookie?.()[0] ?? response.headers.get("set-cookie") ?? "";
    return header.split(";")[0] ?? "";
  }

  function withCookie(cookie: string, init: RequestInit = {}): Promise<Response> {
    return fetch(`${baseUrl}/api/shares/session`, { ...init, headers: { cookie } });
  }

  it("sets an HttpOnly cookie and answers with the public share", async () => {
    const { token, share } = await boardLink();

    const response = await exchange(token);

    expect(response.status).toBe(200);
    const header = response.headers.getSetCookie?.()[0] ?? response.headers.get("set-cookie") ?? "";
    expect(header).toContain("suite_share=");
    expect(header).toContain("HttpOnly");
    expect(header).toContain("Secure");
    expect(header).toContain("SameSite=Lax");
    expect(header).toContain("Path=/");
    expect(header).toMatch(/Max-Age=\d+/);

    const body = (await response.json()) as {
      share: { id: string; workspaceId: string; roomId: string };
      session: string;
    };
    expect(body.share.id).toBe(share.id);
    // The public shape: a projection hides the owner's workspace id.
    expect(body.share.workspaceId).toBe(share.roomId);
    // The permanent token never comes back as a field; the session is a
    // different value. (A projection room id embeds the token by design.)
    expect(body).not.toHaveProperty("token");
    expect(body.session).not.toBe(token);
    expect(cookieOf(response)).toBe(`suite_share=${body.session}`);
  });

  it("refuses unknown and revoked tokens without minting a session", async () => {
    const unknown = await exchange("not-a-token");
    expect(unknown.status).toBe(404);
    expect(unknown.headers.getSetCookie?.() ?? []).toEqual([]);

    const { token, share } = await boardLink();
    await revoke(share.id);
    const revoked = await exchange(token);
    expect(revoked.status).toBe(404);
    expect(revoked.headers.getSetCookie?.() ?? []).toEqual([]);
  });

  it("requires the token in the body, never in the query", async () => {
    const { token } = await boardLink();

    const response = await fetch(
      `${baseUrl}/api/shares/session?token=${encodeURIComponent(token)}`,
      { method: "POST", headers: { "content-type": "application/json" } },
    );

    expect(response.status).toBe(400);
    // A query string never mints a session: the token must arrive in the body.
    expect(response.headers.getSetCookie?.() ?? []).toEqual([]);
  });

  it("resolves the share from the cookie alone", async () => {
    const { token, share } = await boardLink();
    const cookie = cookieOf(await exchange(token));

    const response = await withCookie(cookie);

    expect(response.status).toBe(200);
    const body = (await response.json()) as { share: { id: string; workspaceId: string } };
    expect(body.share.id).toBe(share.id);
    expect(body.share.workspaceId).toBe(share.roomId);
    // Each resolve renews the cookie to the slid expiry.
    expect(response.headers.getSetCookie?.()[0] ?? "").toContain("suite_share=");
  });

  it("answers 404 for a missing or unusable cookie and clears it", async () => {
    const missing = await fetch(`${baseUrl}/api/shares/session`);
    expect(missing.status).toBe(404);

    const empty = await withCookie("suite_share=");
    expect(empty.status).toBe(404);

    const garbage = await withCookie("suite_share=not-a-session");
    expect(garbage.status).toBe(404);
    expect(garbage.headers.getSetCookie?.()[0] ?? "").toContain("Max-Age=0");

    const unrelated = await withCookie("other=1; suite_share=stale");
    expect(unrelated.status).toBe(404);
  });

  it("keeps the legacy token resolve working for links in the wild", async () => {
    const { token, share } = await boardLink();

    const response = await fetch(`${baseUrl}/api/shares/${encodeURIComponent(token)}`);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ share: { id: share.id } });
  });

  it("invalidates a live session when its share is revoked", async () => {
    const { token, share } = await boardLink();
    const cookie = cookieOf(await exchange(token));
    expect((await withCookie(cookie)).status).toBe(200);

    const revoked = await revoke(share.id);

    expect(revoked.status).toBe(200);
    // The revoking browser is told to forget its cookie...
    expect(revoked.headers.getSetCookie?.()[0] ?? "").toContain("Max-Age=0");
    // ...and the credential behind it no longer resolves anywhere.
    expect((await withCookie(cookie)).status).toBe(404);
  });

  it("invalidates a live session on a bulk revoke", async () => {
    const { token } = await boardLink();
    const cookie = cookieOf(await exchange(token));

    const response = await fetch(`${baseUrl}/api/shares?workspaceId=ws-1`, {
      method: "DELETE",
      headers: owner,
    });

    expect(response.status).toBe(200);
    expect(response.headers.getSetCookie?.()[0] ?? "").toContain("Max-Age=0");
    expect((await withCookie(cookie)).status).toBe(404);
  });

  it("clears the session on DELETE", async () => {
    const { token, share } = await boardLink();
    const cookie = cookieOf(await exchange(token));

    const closed = await withCookie(cookie, { method: "DELETE" });

    expect(closed.status).toBe(204);
    expect(closed.headers.getSetCookie?.()[0] ?? "").toContain("Max-Age=0");
    expect((await withCookie(cookie)).status).toBe(404);
    // Closing the browser session leaves the share itself alone.
    await expect(
      fetch(`${baseUrl}/api/shares/${encodeURIComponent(token)}`).then((result) => result.json()),
    ).resolves.toMatchObject({ share: { id: share.id } });
  });

  it("lets an editor session publish with the session credential", async () => {
    const created = await post({
      workspaceId: "ws-1",
      scope: "board",
      role: "editor",
      boardId: "board-1",
    });
    const { token, share } = (await created.json()) as { token: string; share: { id: string } };
    const cookie = cookieOf(await exchange(token));
    const body = (await (await withCookie(cookie)).json()) as { session: string };

    const response = await fetch(
      `${baseUrl}/api/shares/${encodeURIComponent(body.session)}/publish`,
      {
        method: "POST",
        headers: {
          authorization: ["Bearer", body.session].join(" "),
          "content-type": "application/json",
        },
        body: JSON.stringify({ version: {} }),
      },
    );

    expect(response.status).toBe(200);
    expect(published.map((entry) => entry.id)).toEqual([share.id]);
  });
});
