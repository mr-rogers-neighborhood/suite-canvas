import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseWorkspaceFile, WorkspaceDocument } from "@suite/graph";
import { LoroDoc } from "loro-crdt";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ADMIN_API_PATH,
  type AdminRequestDeps,
  type AdminRoomRow,
  FIXTURE_CAPS,
  handleAdminRequest,
  MAX_ADMIN_PAGE,
  METRICS_PATH,
} from "./adminHttp.js";
import { serverVersion } from "./config.js";
import { readLimitOverrides, resolveLimits, writeLimitOverrides } from "./limits.js";
import { createLogger } from "./logging.js";
import { MetricsCollector } from "./metrics.js";
import { createDocumentStore } from "./persistence.js";
import { loroDocumentKey } from "./projectionWorker.js";
import { createSettingsStore } from "./settings.js";
import { createShareStore, hashShareToken, type Share, type ShareStore } from "./shares.js";
import { createWorkspaceRegistry, type WorkspaceRegistry } from "./workspaces.js";

const ADMIN_TOKEN = "admin-token-for-tests";
const OWNER_KEY = "owner-key-for-tests";

const ADMIN_PATHS = [
  ADMIN_API_PATH,
  `${ADMIN_API_PATH}/status`,
  `${ADMIN_API_PATH}/workspaces`,
  `${ADMIN_API_PATH}/workspaces/ws-a`,
  `${ADMIN_API_PATH}/workspaces/ws-a/export`,
  `${ADMIN_API_PATH}/fixtures`,
  `${ADMIN_API_PATH}/rooms`,
  `${ADMIN_API_PATH}/shares?workspaceId=ws-a`,
];

let directory: string;
let documents: ReturnType<typeof createDocumentStore>;
let shares: ShareStore;
let workspaces: WorkspaceRegistry;
let server: Server;
let baseUrl: string;
let rooms: AdminRoomRow[];
let previousToken: string | undefined;

beforeEach(async () => {
  previousToken = process.env.SUITE_ADMIN_TOKEN;
  process.env.SUITE_ADMIN_TOKEN = ADMIN_TOKEN;
  directory = mkdtempSync(join(tmpdir(), "suite-admin-api-"));
  documents = createDocumentStore(join(directory, "documents.sqlite"));
  shares = createShareStore(join(directory, "shares.sqlite"));
  workspaces = createWorkspaceRegistry(join(directory, "workspaces.sqlite"));
  rooms = [];
});

afterEach(async () => {
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  documents.close();
  shares.close();
  workspaces.close();
  if (previousToken === undefined) delete process.env.SUITE_ADMIN_TOKEN;
  else process.env.SUITE_ADMIN_TOKEN = previousToken;
  rmSync(directory, { recursive: true, force: true });
});

function deps(overrides: Partial<AdminRequestDeps> = {}): AdminRequestDeps {
  return {
    documents,
    shares,
    workspaces,
    paths: {
      documents: join(directory, "documents.sqlite"),
      shares: join(directory, "shares.sqlite"),
      workspaces: join(directory, "workspaces.sqlite"),
    },
    rooms: () => rooms,
    ...overrides,
  };
}

async function startServer(overrides: Partial<AdminRequestDeps> = {}): Promise<void> {
  const resolved = deps(overrides);
  server = createServer((request, response) => {
    void handleAdminRequest(request, response, resolved).then((handled) => {
      if (handled || response.writableEnded) return;
      response.writeHead(404, { "content-type": "text/plain" });
      response.end("not found");
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("expected a TCP address");
  baseUrl = `http://127.0.0.1:${address.port}`;
}

function get(path: string, token: string | null = ADMIN_TOKEN): Promise<Response> {
  return fetch(
    `${baseUrl}${path}`,
    token === null
      ? {}
      : {
          headers: { authorization: `Bearer ${token}` },
        },
  );
}

/** A POST or DELETE, optionally with a JSON body and/or a different token. */
function mutation(
  method: "POST" | "DELETE",
  path: string,
  body?: unknown,
  token: string | null = ADMIN_TOKEN,
): Promise<Response> {
  const headers: Record<string, string> = {};
  if (token !== null) headers.authorization = ["Bearer", token].join(" ");
  if (body !== undefined) headers["content-type"] = "application/json";
  return fetch(`${baseUrl}${path}`, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

function seedWorkspace(id: string, cards = 2): void {
  const workspace = new WorkspaceDocument();
  workspace.ensureDefaultTypes();
  workspace.markSeeded();
  const board = workspace.ensureBoard();
  for (let index = 0; index < cards; index += 1) {
    workspace.createCard({
      id: `${id}-card-${index}`,
      typeId: "note",
      boardId: board.id,
      position: { x: index, y: index },
    });
  }
  documents.save(loroDocumentKey(id), workspace.doc.export({ mode: "snapshot" }));
}

describe("admin API", () => {
  it("does not exist while SUITE_ADMIN_TOKEN is unset or empty", async () => {
    await startServer();

    process.env.SUITE_ADMIN_TOKEN = "";
    for (const path of ADMIN_PATHS) {
      expect((await get(path)).status).toBe(404);
    }

    delete process.env.SUITE_ADMIN_TOKEN;
    for (const path of ADMIN_PATHS) {
      expect((await get(path)).status).toBe(404);
    }
  });

  it("rejects a wrong bearer token and accepts the configured one", async () => {
    await startServer();

    const missing = await get(`${ADMIN_API_PATH}/status`, null);
    expect(missing.status).toBe(401);
    const missingBody = (await missing.text()).toLowerCase();
    expect(missingBody).not.toContain(ADMIN_TOKEN);

    const wrong = await get(`${ADMIN_API_PATH}/status`, "not-the-admin-token");
    expect(wrong.status).toBe(401);
    expect(await wrong.text()).not.toContain("not-the-admin-token");

    const accepted = await get(`${ADMIN_API_PATH}/status`);
    expect(accepted.status).toBe(200);
  });

  it("reports status with the documented keys and database sizes", async () => {
    seedWorkspace("ws-a", 1);
    await startServer();

    const response = await get(`${ADMIN_API_PATH}/status`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      ok: boolean;
      uptimeMs: number;
      node: string;
      pid: number;
      databases: Record<string, { path?: string; bytes: number; ok: boolean }>;
      rooms: { total: number; workers: number; clients: number };
      limits: Record<string, number>;
      admin: { enabled: boolean };
    };

    expect(body.ok).toBe(true);
    expect(body.uptimeMs).toBeGreaterThanOrEqual(0);
    expect(body.node).toBe(process.version);
    expect(body.pid).toBe(process.pid);
    expect(body.admin).toEqual({ enabled: true });

    for (const name of ["documents", "shares", "workspaces"]) {
      const database = body.databases[name];
      expect(database, name).toBeDefined();
      expect(typeof database?.bytes).toBe("number");
      expect(Number.isFinite(database?.bytes)).toBe(true);
      expect(database?.bytes).toBeGreaterThan(0);
      expect(database?.ok).toBe(true);
      expect(typeof database?.path).toBe("string");
    }

    expect(body.rooms).toEqual({ total: 0, workers: 0, clients: 0 });
    expect(body.limits).toEqual({
      sharesPerWorkspace: expect.any(Number),
      selectionCards: 200,
      publishPerMinute: expect.any(Number),
      claimPerMinute: expect.any(Number),
    });
    for (const limit of Object.values(body.limits)) {
      expect(Number.isSafeInteger(limit)).toBe(true);
      expect(limit).toBeGreaterThan(0);
    }
  });

  it("lists workspaces with counts and paginates", async () => {
    seedWorkspace("ws-a", 2);
    seedWorkspace("ws-b", 1);
    seedWorkspace("ws-c", 0);
    workspaces.claimOrVerify("ws-a", OWNER_KEY);
    shares.create({ workspaceId: "ws-a", scope: "workspace", role: "viewer" });
    await startServer();

    const response = await get(`${ADMIN_API_PATH}/workspaces`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      workspaces: {
        id: string;
        claimed: boolean;
        documentBytes: number;
        cards: number;
        boards: number;
        sections: number;
        types: number;
        tags: number;
        shares: number;
        lastSavedAt: number | null;
      }[];
      total: number;
    };

    expect(body.total).toBe(3);
    expect(body.workspaces.map((row) => row.id).sort()).toEqual(["ws-a", "ws-b", "ws-c"]);

    const first = body.workspaces.find((row) => row.id === "ws-a");
    expect(first).toBeDefined();
    expect(first).toMatchObject({ claimed: true, cards: 2, shares: 1 });
    expect(first?.boards).toBeGreaterThanOrEqual(1);
    expect(first?.types).toBeGreaterThanOrEqual(1);
    expect(first?.documentBytes).toBeGreaterThan(0);
    expect(first?.lastSavedAt).toBeTypeOf("number");

    const small = (await (await get(`${ADMIN_API_PATH}/workspaces?limit=1`)).json()) as {
      workspaces: { id: string }[];
      total: number;
    };
    expect(small.workspaces).toHaveLength(1);
    expect(small.total).toBe(3);

    const shifted = (await (await get(`${ADMIN_API_PATH}/workspaces?limit=1&offset=1`)).json()) as {
      workspaces: { id: string }[];
    };
    expect(shifted.workspaces).toHaveLength(1);
    expect(shifted.workspaces[0]?.id).not.toBe(small.workspaces[0]?.id);

    const tail = (await (await get(`${ADMIN_API_PATH}/workspaces?limit=2&offset=2`)).json()) as {
      workspaces: { id: string }[];
    };
    expect(tail.workspaces).toHaveLength(1);

    expect((await get(`${ADMIN_API_PATH}/workspaces?limit=two`)).status).toBe(400);
  });

  it("caps the workspace page at 200", async () => {
    expect(MAX_ADMIN_PAGE).toBe(200);
    for (let index = 0; index < MAX_ADMIN_PAGE + 5; index += 1) {
      documents.save(
        loroDocumentKey(`bulk-${String(index).padStart(3, "0")}`),
        new LoroDoc().export({ mode: "snapshot" }),
      );
    }
    await startServer();

    const body = (await (await get(`${ADMIN_API_PATH}/workspaces?limit=1000`)).json()) as {
      workspaces: unknown[];
      total: number;
    };
    expect(body.total).toBe(MAX_ADMIN_PAGE + 5);
    expect(body.workspaces).toHaveLength(MAX_ADMIN_PAGE);
  });

  it("returns a workspace detail and 404s an unknown id", async () => {
    seedWorkspace("ws-a", 1);
    const { token } = shares.create({
      workspaceId: "ws-a",
      scope: "card",
      role: "viewer",
      cardId: "ws-a-card-0",
      expiresAt: Date.now() + 60_000,
    });
    await startServer();

    const response = await get(`${ADMIN_API_PATH}/workspaces/ws-a`);
    expect(response.status).toBe(200);
    const raw = await response.text();
    const body = JSON.parse(raw) as {
      id: string;
      cards: number;
      shareList: { id: string; cardCount: number; expiresAt: number | null }[];
      versions: Record<string, number>;
      schemaVersion: number | null;
    };
    expect(body.id).toBe("ws-a");
    expect(body.cards).toBe(1);
    expect(body.shareList).toHaveLength(1);
    expect(body.shareList[0]?.cardCount).toBe(1);
    expect(body.shareList[0]?.expiresAt).toBeTypeOf("number");
    expect(body.schemaVersion).toBeTypeOf("number");
    expect(Object.keys(body.versions).length).toBeGreaterThan(0);
    expect(raw).not.toContain(token);
    expect(raw).not.toContain(hashShareToken(token));

    expect((await get(`${ADMIN_API_PATH}/workspaces/missing`)).status).toBe(404);
  });

  it("reports rooms with auth kinds only when the sync server can", async () => {
    rooms = [
      {
        roomId: "ws-a",
        clients: 3,
        authKinds: { owner: 1, share: 1, internal: 1, anonymous: 0 },
      },
    ];
    await startServer();

    const response = await get(`${ADMIN_API_PATH}/rooms`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { rooms: AdminRoomRow[] };
    expect(body.rooms).toEqual([
      {
        roomId: "ws-a",
        clients: 3,
        authKinds: { owner: 1, share: 1, internal: 1, anonymous: 0 },
      },
    ]);

    const status = (await (await get(`${ADMIN_API_PATH}/status`)).json()) as {
      rooms: { total: number; workers: number; clients: number };
    };
    expect(status.rooms).toEqual({ total: 1, workers: 1, clients: 3 });

    const withoutRooms = deps();
    delete withoutRooms.rooms;
    const fallback = createServer((request, serverResponse) => {
      void handleAdminRequest(request, serverResponse, withoutRooms).then((handled) => {
        if (handled || serverResponse.writableEnded) return;
        serverResponse.writeHead(404);
        serverResponse.end();
      });
    });
    await new Promise<void>((resolve) => fallback.listen(0, "127.0.0.1", resolve));
    const fallbackAddress = fallback.address();
    if (!fallbackAddress || typeof fallbackAddress === "string") {
      throw new Error("expected a TCP address");
    }
    try {
      const listed = await fetch(
        `http://127.0.0.1:${fallbackAddress.port}${ADMIN_API_PATH}/rooms`,
        { headers: { authorization: `Bearer ${ADMIN_TOKEN}` } },
      );
      expect(listed.status).toBe(200);
      expect(await listed.json()).toMatchObject({ rooms: [], projectionRooms: [] });
    } finally {
      await new Promise<void>((resolve) => fallback.close(() => resolve()));
    }
  });

  it("lists shares with card counts and expiry but no credentials", async () => {
    const workspaceShare = shares.create({
      workspaceId: "ws-a",
      scope: "workspace",
      role: "editor",
    });
    const cardShare = shares.create({
      workspaceId: "ws-a",
      scope: "card",
      role: "viewer",
      cardId: "ws-a-card-0",
      expiresAt: Date.now() + 60_000,
    });
    seedWorkspace("ws-a", 1);
    await startServer();

    const response = await get(`${ADMIN_API_PATH}/shares?workspaceId=ws-a`);
    expect(response.status).toBe(200);
    const raw = await response.text();
    const body = JSON.parse(raw) as {
      workspaceId: string;
      shares: { id: string; cardCount: number; expiresAt: number | null }[];
    };
    expect(body.workspaceId).toBe("ws-a");
    expect(body.shares).toHaveLength(2);

    const card = body.shares.find((entry) => entry.id === cardShare.share.id);
    expect(card?.cardCount).toBe(1);
    expect(card?.expiresAt).toBeTypeOf("number");
    const workspace = body.shares.find((entry) => entry.id === workspaceShare.share.id);
    expect(workspace?.cardCount).toBe(0);
    expect(workspace?.expiresAt).toBeNull();

    expect((await get(`${ADMIN_API_PATH}/shares`)).status).toBe(400);

    const secrets = [
      ADMIN_TOKEN,
      OWNER_KEY,
      workspaceShare.token,
      cardShare.token,
      hashShareToken(workspaceShare.token),
      hashShareToken(cardShare.token),
      `share-${cardShare.token}`,
    ];
    const responses = await Promise.all([
      get(`${ADMIN_API_PATH}/status`),
      get(`${ADMIN_API_PATH}/workspaces`),
      get(`${ADMIN_API_PATH}/workspaces/ws-a`),
      get(`${ADMIN_API_PATH}/rooms`),
      get(`${ADMIN_API_PATH}/shares?workspaceId=ws-a`),
    ]);
    for (const each of responses) {
      const serialized = await each.text();
      for (const secret of secrets) {
        expect(serialized).not.toContain(secret);
      }
    }
    for (const secret of secrets) {
      expect(raw).not.toContain(secret);
    }
  });
});

describe("admin mutations", () => {
  const MUTATIONS: readonly ["POST" | "DELETE", string][] = [
    ["POST", `${ADMIN_API_PATH}/shares/any-share/revoke`],
    ["DELETE", `${ADMIN_API_PATH}/shares?workspaceId=ws-a`],
    ["POST", `${ADMIN_API_PATH}/workspaces/ws-a/reset-owner`],
    ["POST", `${ADMIN_API_PATH}/rooms/ws-a/disconnect`],
    ["DELETE", `${ADMIN_API_PATH}/workspaces/ws-a`],
  ];

  it("requires the admin token for every mutation", async () => {
    await startServer();

    for (const [method, path] of MUTATIONS) {
      const missing = await mutation(method, path, undefined, null);
      expect(missing.status, path).toBe(401);
      expect(await missing.text()).not.toContain(ADMIN_TOKEN);

      const wrong = await mutation(method, path, { confirm: "ws-a" }, "not-the-admin-token");
      expect(wrong.status, path).toBe(401);
    }

    process.env.SUITE_ADMIN_TOKEN = "";
    for (const [method, path] of MUTATIONS) {
      expect((await mutation(method, path, { confirm: "ws-a" })).status, path).toBe(404);
    }

    delete process.env.SUITE_ADMIN_TOKEN;
    for (const [method, path] of MUTATIONS) {
      expect((await mutation(method, path, { confirm: "ws-a" })).status, path).toBe(404);
    }
  });

  it("rejects the wrong method on each route", async () => {
    await startServer();

    expect((await get(`${ADMIN_API_PATH}/shares/any-share/revoke`)).status).toBe(405);
    expect((await get(`${ADMIN_API_PATH}/workspaces/ws-a/reset-owner`)).status).toBe(405);
    expect((await get(`${ADMIN_API_PATH}/rooms/ws-a/disconnect`)).status).toBe(405);
    expect((await mutation("POST", `${ADMIN_API_PATH}/status`)).status).toBe(405);
    expect((await mutation("POST", `${ADMIN_API_PATH}/workspaces`, {})).status).toBe(405);
  });

  it("revokes one share through the store and reports the count", async () => {
    const created = shares.create({
      workspaceId: "ws-a",
      scope: "card",
      role: "viewer",
      cardId: "ws-a-card-0",
    });
    const removed: Share[] = [];
    const changed: string[] = [];
    await startServer({
      onShareRemoved: (share) => removed.push(share),
      onSharesChanged: (workspaceId) => changed.push(workspaceId),
    });

    const response = await mutation("POST", `${ADMIN_API_PATH}/shares/${created.share.id}/revoke`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      ok: boolean;
      workspaceId: string;
      revoked: number;
      share: { id: string; revokedAt: number | null };
    };
    expect(body.ok).toBe(true);
    expect(body.workspaceId).toBe("ws-a");
    expect(body.revoked).toBe(1);
    expect(body.share.id).toBe(created.share.id);
    expect(body.share.revokedAt).toBeTypeOf("number");
    expect(shares.get(created.share.id)?.revokedAt).toBeTypeOf("number");
    expect(shares.list("ws-a")).toHaveLength(0);
    expect(removed.map((share) => share.id)).toEqual([created.share.id]);
    expect(changed).toEqual(["ws-a"]);

    const again = (await (
      await mutation("POST", `${ADMIN_API_PATH}/shares/${created.share.id}/revoke`)
    ).json()) as { revoked: number };
    expect(again.revoked).toBe(0);
    expect(removed).toHaveLength(1);

    expect((await mutation("POST", `${ADMIN_API_PATH}/shares/missing/revoke`)).status).toBe(404);
  });

  it("revokes every link of a workspace and leaves other workspaces alone", async () => {
    const workspaceShare = shares.create({
      workspaceId: "ws-a",
      scope: "workspace",
      role: "viewer",
    });
    const cardShare = shares.create({
      workspaceId: "ws-a",
      scope: "card",
      role: "viewer",
      cardId: "ws-a-card-0",
    });
    const other = shares.create({ workspaceId: "ws-b", scope: "workspace", role: "viewer" });
    const removed: Share[] = [];
    const changed: string[] = [];
    await startServer({
      onShareRemoved: (share) => removed.push(share),
      onSharesChanged: (workspaceId) => changed.push(workspaceId),
    });

    const response = await mutation("DELETE", `${ADMIN_API_PATH}/shares?workspaceId=ws-a`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { revoked: number; shares: { id: string }[] };
    const expected = [cardShare.share.id, workspaceShare.share.id].sort();
    expect(body.revoked).toBe(2);
    expect(body.shares.map((share) => share.id).sort()).toEqual(expected);
    expect(shares.list("ws-a")).toHaveLength(0);
    expect(shares.list("ws-b")).toHaveLength(1);
    expect(shares.get(other.share.id)?.revokedAt).toBeNull();
    expect(removed.map((share) => share.id).sort()).toEqual(expected);
    expect(changed).toEqual(["ws-a"]);

    expect((await mutation("DELETE", `${ADMIN_API_PATH}/shares`)).status).toBe(400);
    expect(
      (await mutation("DELETE", `${ADMIN_API_PATH}/shares?workspaceId=ws-missing`)).status,
    ).toBe(404);
  });

  it("resets the owner key so the workspace can be claimed again", async () => {
    seedWorkspace("ws-a", 1);
    expect(workspaces.claimOrVerify("ws-a", OWNER_KEY)).toBe("owner");
    const created = shares.create({
      workspaceId: "ws-a",
      scope: "card",
      role: "viewer",
      cardId: "ws-a-card-0",
    });
    await startServer();

    const response = await mutation("POST", `${ADMIN_API_PATH}/workspaces/ws-a/reset-owner`, {});
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      ok: boolean;
      revokeShares: boolean;
      ownerRows: number;
      revoked: number;
    };
    expect(body.ok).toBe(true);
    expect(body.revokeShares).toBe(false);
    expect(body.ownerRows).toBe(1);
    expect(body.revoked).toBe(0);

    expect(workspaces.has("ws-a")).toBe(false);
    expect(workspaces.claimOrVerify("ws-a", "a-brand-new-key")).toBe("owner");
    expect(workspaces.verify("ws-a", "a-brand-new-key")).toBe(true);
    // Without revokeShares the document and the link keep working.
    expect(documents.load(loroDocumentKey("ws-a"))).not.toBeNull();
    expect(shares.get(created.share.id)?.revokedAt).toBeNull();

    expect(
      (await mutation("POST", `${ADMIN_API_PATH}/workspaces/ws-missing/reset-owner`, {})).status,
    ).toBe(404);
    expect(
      (
        await mutation("POST", `${ADMIN_API_PATH}/workspaces/ws-a/reset-owner`, {
          revokeShares: "yes",
        })
      ).status,
    ).toBe(400);
  });

  it("resets the owner key and revokes links when asked", async () => {
    seedWorkspace("ws-a", 1);
    workspaces.claimOrVerify("ws-a", OWNER_KEY);
    const created = shares.create({
      workspaceId: "ws-a",
      scope: "card",
      role: "viewer",
      cardId: "ws-a-card-0",
    });
    const roomId = created.share.roomId;
    if (!roomId) throw new Error("expected the share to have a projection room");
    shares.setBaseline(created.share.id, new LoroDoc().export({ mode: "snapshot" }));
    documents.save(loroDocumentKey(roomId), new LoroDoc().export({ mode: "snapshot" }));
    const removed: Share[] = [];
    await startServer({ onShareRemoved: (share) => removed.push(share) });

    const response = await mutation("POST", `${ADMIN_API_PATH}/workspaces/ws-a/reset-owner`, {
      revokeShares: true,
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      revokeShares: boolean;
      revoked: number;
      baselines: number;
      projected: number;
      ownerRows: number;
    };
    expect(body.revokeShares).toBe(true);
    expect(body.revoked).toBe(1);
    expect(body.baselines).toBe(1);
    expect(body.projected).toBe(1);
    expect(body.ownerRows).toBe(1);

    expect(workspaces.has("ws-a")).toBe(false);
    expect(shares.list("ws-a")).toHaveLength(0);
    expect(shares.getBaseline(created.share.id)).toBeNull();
    expect(documents.load(loroDocumentKey(roomId))).toBeNull();
    expect(removed.map((share) => share.id)).toEqual([created.share.id]);
  });

  it("closes every session in a room and changes nothing else", async () => {
    seedWorkspace("ws-a", 1);
    workspaces.claimOrVerify("ws-a", OWNER_KEY);
    const created = shares.create({ workspaceId: "ws-a", scope: "workspace", role: "viewer" });
    const asked: string[] = [];
    await startServer({
      disconnectRoom: (roomId) => {
        asked.push(roomId);
        return 3;
      },
    });

    const response = await mutation("POST", `${ADMIN_API_PATH}/rooms/ws-a/disconnect`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, roomId: "ws-a", closed: 3 });
    expect(asked).toEqual(["ws-a"]);

    expect(workspaces.has("ws-a")).toBe(true);
    expect(shares.get(created.share.id)?.revokedAt).toBeNull();
    expect(documents.load(loroDocumentKey("ws-a"))).not.toBeNull();
  });

  it("answers 501 when the server cannot close rooms", async () => {
    await startServer();
    expect((await mutation("POST", `${ADMIN_API_PATH}/rooms/ws-a/disconnect`)).status).toBe(501);
  });

  it("requires an explicit confirmation before deleting a workspace", async () => {
    seedWorkspace("ws-a", 1);
    await startServer();

    expect((await mutation("DELETE", `${ADMIN_API_PATH}/workspaces/ws-a`)).status).toBe(400);
    expect(
      (await mutation("DELETE", `${ADMIN_API_PATH}/workspaces/ws-a`, { confirm: "ws-b" })).status,
    ).toBe(400);
    expect(
      (await mutation("DELETE", `${ADMIN_API_PATH}/workspaces/ws-a`, { confirm: 42 })).status,
    ).toBe(400);
    expect(documents.load(loroDocumentKey("ws-a"))).not.toBeNull();
  });

  it("deletes the document, links, baselines and projections of a workspace", async () => {
    seedWorkspace("ws-a", 1);
    workspaces.claimOrVerify("ws-a", OWNER_KEY);
    const created = shares.create({
      workspaceId: "ws-a",
      scope: "card",
      role: "viewer",
      cardId: "ws-a-card-0",
    });
    const roomId = created.share.roomId;
    if (!roomId) throw new Error("expected the share to have a projection room");
    shares.setBaseline(created.share.id, new LoroDoc().export({ mode: "snapshot" }));
    documents.save(loroDocumentKey(roomId), new LoroDoc().export({ mode: "snapshot" }));
    const removed: Share[] = [];
    await startServer({ onShareRemoved: (share) => removed.push(share) });

    const response = await mutation("DELETE", `${ADMIN_API_PATH}/workspaces/ws-a`, {
      confirm: "ws-a",
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      ok: boolean;
      documents: number;
      projected: number;
      shares: number;
      baselines: number;
      ownerRows: number;
    };
    expect(body.ok).toBe(true);
    expect(body.documents).toBe(1);
    expect(body.projected).toBe(1);
    expect(body.shares).toBe(1);
    expect(body.baselines).toBe(1);
    expect(body.ownerRows).toBe(1);

    expect(documents.load(loroDocumentKey("ws-a"))).toBeNull();
    expect(documents.load(loroDocumentKey(roomId))).toBeNull();
    expect(shares.list("ws-a")).toHaveLength(0);
    expect(shares.get(created.share.id)).toBeNull();
    expect(shares.getBaseline(created.share.id)).toBeNull();
    expect(workspaces.has("ws-a")).toBe(false);
    expect(removed.map((share) => share.id)).toEqual([created.share.id]);

    expect(
      (await mutation("DELETE", `${ADMIN_API_PATH}/workspaces/ws-a`, { confirm: "ws-a" })).status,
    ).toBe(404);
  });

  it("404s every id-addressed mutation for an unknown id", async () => {
    seedWorkspace("ws-a", 1);
    await startServer();

    expect((await mutation("POST", `${ADMIN_API_PATH}/shares/nope/revoke`)).status).toBe(404);
    expect((await mutation("DELETE", `${ADMIN_API_PATH}/shares?workspaceId=nope`)).status).toBe(
      404,
    );
    expect(
      (await mutation("POST", `${ADMIN_API_PATH}/workspaces/nope/reset-owner`, {})).status,
    ).toBe(404);
    expect(
      (await mutation("DELETE", `${ADMIN_API_PATH}/workspaces/nope`, { confirm: "nope" })).status,
    ).toBe(404);
  });

  it("writes one audit line per mutation without the token", async () => {
    seedWorkspace("ws-a", 1);
    const lines: string[] = [];
    const logger = createLogger({ level: "debug", write: (line) => lines.push(line) });
    await startServer({ logger });

    const response = await mutation("POST", `${ADMIN_API_PATH}/workspaces/ws-a/reset-owner`, {});
    expect(response.status).toBe(200);
    expect(await response.text()).not.toContain(ADMIN_TOKEN);

    const auditLines = lines.filter((line) => line.includes("admin.mutation"));
    expect(auditLines).toHaveLength(1);
    const record = JSON.parse(auditLines[0] ?? "{}") as Record<string, unknown>;
    expect(record.path).toBe(`${ADMIN_API_PATH}/workspaces/ws-a/reset-owner`);
    expect(record.target).toBe("ws-a");
    expect(record.action).toBe("reset-owner");
    expect(record.outcome).toBe("owner-key-removed");
    for (const line of lines) expect(line).not.toContain(ADMIN_TOKEN);
  });

  it("reports the projection rooms the worker holds", async () => {
    const projectionRooms = [
      {
        roomId: "share-link-token",
        shareId: "share-1",
        workspaceId: "ws-a",
        role: "editor" as const,
        hasBaseline: true,
        dirty: true,
      },
    ];
    await startServer({ projectionRooms: () => projectionRooms });

    const response = await get(`${ADMIN_API_PATH}/rooms`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      rooms: AdminRoomRow[];
      projectionRooms: typeof projectionRooms;
      note: string;
    };
    expect(body.rooms).toEqual([]);
    expect(body.projectionRooms).toEqual(projectionRooms);
    expect(body.note.toLowerCase()).toContain("projection");
  });

  it("creates a fixture workspace with the requested counts and a usable owner key", async () => {
    await startServer();

    const response = await mutation("POST", `${ADMIN_API_PATH}/fixtures`, {
      boards: 3,
      cards: 7,
      sections: 2,
      shares: 3,
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      ok: boolean;
      workspaceId: string;
      ownerKey: string | null;
      boards: string[];
      cards: string[];
      sections: string[];
      shares: { scope: string; token: string; url: string }[];
    };

    expect(body.ok).toBe(true);
    expect(body.workspaceId.length).toBeGreaterThan(0);
    expect(body.ownerKey).toBeTypeOf("string");
    expect(body.boards).toHaveLength(3);
    expect(body.cards).toHaveLength(7);
    expect(body.sections).toHaveLength(2);
    expect(body.shares).toHaveLength(3);

    // Explicit ids make a run reproducible, and the run token keeps two calls apart.
    const ids = [...body.boards, ...body.cards, ...body.sections];
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every((id) => id.startsWith("fx-"))).toBe(true);

    const ownerKey = body.ownerKey;
    if (ownerKey === null) throw new Error("expected a fixture owner key");
    expect(workspaces.verify(body.workspaceId, ownerKey)).toBe(true);

    const detail = (await (
      await get(`${ADMIN_API_PATH}/workspaces/${body.workspaceId}`)
    ).json()) as {
      id: string;
      claimed: boolean;
      boards: number;
      cards: number;
      sections: number;
      shares: number;
      schemaVersion: number | null;
    };
    expect(detail).toMatchObject({
      id: body.workspaceId,
      claimed: true,
      boards: 3,
      cards: 7,
      sections: 2,
      shares: 3,
    });
    expect(detail.schemaVersion).toBeTypeOf("number");

    for (const share of body.shares) {
      expect(share.url).toContain(`share=${share.token}`);
      expect(shares.resolve(share.token)).not.toBeNull();
    }
    expect(body.shares.filter((share) => share.scope === "card")).toHaveLength(1);

    const second = (await (
      await mutation("POST", `${ADMIN_API_PATH}/fixtures`, {
        workspaceId: body.workspaceId,
        boards: 1,
        cards: 2,
      })
    ).json()) as {
      workspaceId: string;
      ownerKey: string | null;
      boards: string[];
      cards: string[];
    };
    // An existing owner key is never replaced, so seeding cannot hand out access.
    expect(second.workspaceId).toBe(body.workspaceId);
    expect(second.ownerKey).toBeNull();
    expect(second.boards).toHaveLength(1);
    expect(second.cards).toHaveLength(2);

    const grown = (await (
      await get(`${ADMIN_API_PATH}/workspaces/${body.workspaceId}`)
    ).json()) as { boards: number; cards: number };
    expect(grown.boards).toBe(4);
    expect(grown.cards).toBe(9);
  });

  it("rejects fixture counts above the caps with a readable 400", async () => {
    await startServer();

    for (const [key, cap] of Object.entries(FIXTURE_CAPS)) {
      const response = await mutation("POST", `${ADMIN_API_PATH}/fixtures`, { [key]: cap + 1 });
      expect(response.status, key).toBe(400);
      const message = (await response.text()).toLowerCase();
      expect(message).toContain(key);
      expect(message).toContain(String(cap));
    }

    expect((await mutation("POST", `${ADMIN_API_PATH}/fixtures`, { cards: -1 })).status).toBe(400);
    expect((await mutation("POST", `${ADMIN_API_PATH}/fixtures`, { boards: 1.5 })).status).toBe(
      400,
    );
    expect(
      (await mutation("POST", `${ADMIN_API_PATH}/fixtures`, { workspaceId: "share-nope" })).status,
    ).toBe(400);
  });

  it("exports a stored workspace as a .suite envelope and 404s an unknown one", async () => {
    seedWorkspace("ws-a", 2);
    await startServer();

    const response = await get(`${ADMIN_API_PATH}/workspaces/ws-a/export`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    const disposition = response.headers.get("content-disposition") ?? "";
    expect(disposition).toContain("attachment");
    expect(disposition).toContain(".suite");

    const body = (await response.json()) as unknown;
    const parsed = parseWorkspaceFile(body);
    expect(parsed.file).toMatchObject({ workspaceId: "ws-a", kind: "suite.workspace" });
    expect(parsed.file.manifest.cards).toBe(2);
    expect(parsed.workspace.listCards()).toHaveLength(2);

    expect((await get(`${ADMIN_API_PATH}/workspaces/missing/export`)).status).toBe(404);
  });

  it("hides fixtures and export while SUITE_ADMIN_TOKEN is unset", async () => {
    seedWorkspace("ws-a", 1);
    await startServer();

    process.env.SUITE_ADMIN_TOKEN = "";
    expect(
      (await mutation("POST", `${ADMIN_API_PATH}/fixtures`, { boards: 1, cards: 1 })).status,
    ).toBe(404);
    expect((await get(`${ADMIN_API_PATH}/workspaces/ws-a/export`)).status).toBe(404);

    delete process.env.SUITE_ADMIN_TOKEN;
    expect(
      (await mutation("POST", `${ADMIN_API_PATH}/fixtures`, { boards: 1, cards: 1 })).status,
    ).toBe(404);
    expect((await get(`${ADMIN_API_PATH}/workspaces/ws-a/export`)).status).toBe(404);
  });
});

describe("document store inventory", () => {
  it("lists stored documents with their size and reports the database size", () => {
    const store = createDocumentStore(join(directory, "inventory.sqlite"));
    try {
      expect(store.list()).toEqual([]);

      const state = new LoroDoc().export({ mode: "snapshot" });
      store.save(loroDocumentKey("ws-a"), state);

      const listed = store.list();
      expect(listed).toHaveLength(1);
      expect(listed[0]?.name).toBe(loroDocumentKey("ws-a"));
      expect(listed[0]?.bytes).toBe(state.byteLength);
      expect(listed[0]?.updatedAt).toBeTypeOf("number");

      store.delete(loroDocumentKey("ws-a"));
      expect(store.list()).toEqual([]);
      expect(store.size()).toBeGreaterThan(0);
    } finally {
      store.close();
    }
  });
});

describe("limit tuning", () => {
  let docs: ReturnType<typeof createDocumentStore>;
  let shareStore: ShareStore;
  let otherRegistry: WorkspaceRegistry;
  let settings: ReturnType<typeof createSettingsStore>;
  let lines: string[];
  let local: Server | null = null;

  beforeEach(() => {
    docs = createDocumentStore(":memory:");
    shareStore = createShareStore(":memory:");
    otherRegistry = createWorkspaceRegistry(":memory:");
    settings = createSettingsStore();
    lines = [];
    local = null;
  });

  afterEach(async () => {
    if (local) await new Promise<void>((resolve) => local?.close(() => resolve()));
    docs.close();
    shareStore.close();
    otherRegistry.close();
    settings.close();
    vi.unstubAllEnvs();
  });

  async function serve(withSettings = true, extra: Partial<AdminRequestDeps> = {}): Promise<void> {
    const logger = createLogger({ level: "debug", write: (line) => lines.push(line) });
    const deps: AdminRequestDeps = {
      documents: docs,
      shares: shareStore,
      workspaces: otherRegistry,
      limits: () => resolveLimits(process.env, readLimitOverrides(settings)),
      diskBytes: () => 4096,
      logger,
      ...extra,
    };
    if (withSettings) deps.settings = settings;
    const server = createServer((request, response) => {
      void handleAdminRequest(request, response, deps).then((handled) => {
        if (handled || response.writableEnded) return;
        response.writeHead(404, { "content-type": "text/plain" });
        response.end("not found");
      });
    });
    local = server;
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("expected a TCP address");
    baseUrl = `http://127.0.0.1:${address.port}`;
  }

  function putLimits(body: unknown, token: string | null = ADMIN_TOKEN): Promise<Response> {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (token !== null) headers.authorization = ["Bearer", token].join(" ");
    return fetch(`${baseUrl}${ADMIN_API_PATH}/limits`, {
      method: "PUT",
      headers,
      body: JSON.stringify(body),
    });
  }

  function auditLines(): { msg: string; action?: string; outcome?: string; details?: unknown }[] {
    return lines
      .map((line) => {
        try {
          return JSON.parse(line) as { msg: string };
        } catch {
          return null;
        }
      })
      .filter((entry): entry is { msg: string } => entry !== null);
  }

  it("reports the effective limits with their source", async () => {
    vi.stubEnv("SUITE_MAX_WORKSPACES", "9");
    await serve();

    const response = await get(`${ADMIN_API_PATH}/limits`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      ok: boolean;
      hosted: boolean;
      limits: Record<string, number | null>;
      sources: Record<string, string>;
      env: Record<string, string>;
      overrides: Record<string, number | null>;
      diskBytes: number;
      problems: string[];
    };

    expect(body.ok).toBe(true);
    expect(body.hosted).toBe(false);
    expect(body.limits.maxWorkspaces).toBe(9);
    expect(body.limits.documentBytesPerWorkspace).toBeNull();
    expect(body.limits.sharesPerWorkspace).toBe(100);
    expect(body.sources.maxWorkspaces).toBe("env");
    expect(body.sources.documentBytesPerWorkspace).toBe("default");
    expect(body.env.maxWorkspaces).toBe("SUITE_MAX_WORKSPACES");
    expect(body.overrides).toEqual({});
    expect(body.diskBytes).toBe(4096);
    expect(body.problems).toEqual([]);
  });

  it("stores a validated override, applies it at once and audits it", async () => {
    await serve();

    const response = await putLimits({ maxWorkspaces: 4, documentBytesPerWorkspace: 2048 });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      limits: Record<string, number | null>;
      sources: Record<string, string>;
      overrides: Record<string, number | null>;
    };
    expect(body.limits.maxWorkspaces).toBe(4);
    expect(body.limits.documentBytesPerWorkspace).toBe(2048);
    expect(body.sources.maxWorkspaces).toBe("override");
    expect(body.overrides).toEqual({ maxWorkspaces: 4, documentBytesPerWorkspace: 2048 });

    expect(readLimitOverrides(settings)).toEqual({
      maxWorkspaces: 4,
      documentBytesPerWorkspace: 2048,
    });

    const reread = (await (await get(`${ADMIN_API_PATH}/limits`)).json()) as {
      limits: Record<string, number | null>;
    };
    expect(reread.limits.maxWorkspaces).toBe(4);

    const line = auditLines().find(
      (entry) => entry.msg === "admin.mutation" && entry.action === "limits.update",
    );
    expect(line).toBeDefined();
    expect(line?.outcome).toBe("updated");
  });

  it("accepts null to clear an override and the word unlimited", async () => {
    writeLimitOverrides(settings, { maxWorkspaces: 4, diskHardBytes: 1 });
    await serve();

    const cleared = await putLimits({ maxWorkspaces: null, diskHardBytes: "unlimited" });
    expect(cleared.status).toBe(200);
    const body = (await cleared.json()) as { overrides: Record<string, number | null> };
    expect(body.overrides).toEqual({ diskHardBytes: null });
    expect(readLimitOverrides(settings)).toEqual({ diskHardBytes: Number.POSITIVE_INFINITY });
  });

  it("refuses an unknown key and a contradictory pair, and audits both", async () => {
    await serve();

    const unknown = await putLimits({ diskHardByte: 10 });
    expect(unknown.status).toBe(400);
    expect(((await unknown.json()) as { error: string }).error).toContain(
      'Unknown limit "diskHardByte"',
    );

    const contradictory = await putLimits({ diskSoftBytes: 10, diskHardBytes: 5 });
    expect(contradictory.status).toBe(400);
    expect(((await contradictory.json()) as { error: string }).error).toContain("soft watermark");

    const rejected = auditLines().filter(
      (entry) => entry.action === "limits.update" && entry.outcome === "rejected",
    );
    expect(rejected).toHaveLength(2);
    expect(readLimitOverrides(settings)).toEqual({});
  });

  it("refuses a body with no known limit", async () => {
    await serve();
    const empty = await putLimits({});
    expect(empty.status).toBe(400);
    expect(((await empty.json()) as { error: string }).error).toContain("No limits were given");
  });

  it("requires the admin token", async () => {
    await serve();
    expect((await putLimits({ maxWorkspaces: 2 }, null)).status).toBe(401);
    expect(readLimitOverrides(settings)).toEqual({});
  });

  it("answers 501 when the server has no settings store", async () => {
    await serve(false);
    const response = await putLimits({ maxWorkspaces: 2 });
    expect(response.status).toBe(501);
    expect(((await response.json()) as { error: string }).error).toContain("SUITE_SETTINGS_DB");
  });

  it("marks an over-quota workspace in the list and reports the disk reading", async () => {
    writeLimitOverrides(settings, { documentBytesPerWorkspace: 1024 });
    docs.save(loroDocumentKey("ws-big"), new Uint8Array(2048));
    docs.save(loroDocumentKey("ws-small"), new Uint8Array(10));
    await serve();

    const response = await get(`${ADMIN_API_PATH}/workspaces`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      workspaces: { id: string; documentBytes: number; overQuota: boolean }[];
      total: number;
      diskBytes: number;
    };
    expect(body.diskBytes).toBe(4096);
    const big = body.workspaces.find((row) => row.id === "ws-big");
    const small = body.workspaces.find((row) => row.id === "ws-small");
    expect(big).toMatchObject({ documentBytes: 2048, overQuota: true });
    expect(small).toMatchObject({ documentBytes: 10, overQuota: false });
  });

  it("shows over-quota on a workspace detail too", async () => {
    writeLimitOverrides(settings, { documentBytesPerWorkspace: 1024 });
    docs.save(loroDocumentKey("ws-big"), new Uint8Array(2048));
    await serve();

    const response = await get(`${ADMIN_API_PATH}/workspaces/ws-big`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { overQuota: boolean; documentBytes: number };
    expect(body.overQuota).toBe(true);
    expect(body.documentBytes).toBe(2048);
  });
});

describe("metrics endpoint", () => {
  it("404s when SUITE_ADMIN_TOKEN is unset, so the route does not advertise itself", async () => {
    await startServer();

    process.env.SUITE_ADMIN_TOKEN = "";
    expect((await get(METRICS_PATH)).status).toBe(404);

    delete process.env.SUITE_ADMIN_TOKEN;
    expect((await get(METRICS_PATH)).status).toBe(404);
  });

  it("401s without a token and with a wrong one", async () => {
    await startServer();

    const missing = await get(METRICS_PATH, null);
    expect(missing.status).toBe(401);
    expect(await missing.text()).not.toContain("suite_http_requests_total");

    const wrong = await get(METRICS_PATH, "not-the-admin-token");
    expect(wrong.status).toBe(401);
    expect(await wrong.text()).not.toContain("not-the-admin-token");
  });

  it("serves Prometheus text to the configured token", async () => {
    const collector = new MetricsCollector({
      version: "9.9.9",
      gauges: {
        databaseBytes: () => 2048,
        diskSoftBytes: () => 1024,
        openRooms: () => 3,
        projectionRooms: () => 2,
        documents: () => 9,
      },
    });
    collector.observeHttp(200);
    collector.shareCreated();
    await startServer({ metrics: collector });

    const response = await get(METRICS_PATH);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/plain");
    expect(response.headers.get("cache-control")).toBe("no-store");

    const body = await response.text();
    expect(body).toContain('suite_http_requests_total{class="2xx"} 1');
    expect(body).toContain("suite_share_creates_total 1");
    expect(body).toContain("suite_disk_above_soft 1");
    expect(body).toContain('suite_build_info{version="9.9.9"} 1');
    expect(body).not.toContain(ADMIN_TOKEN);
    expect(body).not.toContain("ws-a");
  });

  it("reports the version stamp in the admin status", async () => {
    await startServer();

    const response = await get(`${ADMIN_API_PATH}/status`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { version: string };
    expect(body.version).toBe(serverVersion());
    expect(body.version.length).toBeGreaterThan(0);
  });
});
