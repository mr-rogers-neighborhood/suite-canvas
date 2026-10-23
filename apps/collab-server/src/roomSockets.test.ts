import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LoroAdaptor } from "loro-adaptors/loro";
import { LoroDoc } from "loro-crdt";
import { LoroWebsocketClient } from "loro-websocket";
import { SimpleServer } from "loro-websocket/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// loro-websocket 0.6.2 rejects its internal connection promise from close()/
// destroy() without attaching a handler. These are teardown-only rejections.
process.on("unhandledRejection", (reason) => {
  if (reason instanceof Error && /^(Destroyed|Disconnected)$/u.test(reason.message)) return;
  throw reason;
});

import { authorize } from "./auth.js";
import {
  disconnectAuthSessions,
  disconnectProjectionViewers,
  disconnectWorkspaceShares,
  flushDirtyDocuments,
  type KickServer,
} from "./roomSockets.js";
import { createShareStore, type Share, type ShareStore } from "./shares.js";
import { createWorkspaceRegistry, type WorkspaceRegistry } from "./workspaces.js";

const PROJECTION_TOKEN = "projection-token";
const SOURCE_TOKEN = "source-token";
const OWNER_KEY = "owner-key";
const WORKSPACE_ID = "ws-1";
const BOARD_ID = "board-1";

/** Records the predicates the wrapper hands to the patched server. */
function recordingServer() {
  const roomCalls: {
    roomId: string;
    predicate: (auth: string, roomId: string) => boolean;
  }[] = [];
  const authCalls: string[] = [];
  const server: KickServer = {
    disconnectRoomWhere(roomId, predicate) {
      roomCalls.push({ roomId, predicate });
      return 3;
    },
    disconnectAuth(auth) {
      authCalls.push(auth);
      return 4;
    },
  };
  return { server, roomCalls, authCalls };
}

describe("disconnectProjectionViewers", () => {
  it("closes the link's own sessions in its projection room", () => {
    const { server, roomCalls } = recordingServer();
    expect(disconnectProjectionViewers(server, "share-link", PROJECTION_TOKEN)).toBe(3);
    const call = roomCalls[0];
    expect(call?.roomId).toBe("share-link");
    expect(call?.predicate("share-link", "share-link")).toBe(true);
  });

  it("keeps the projection worker that builds the room", () => {
    const { server, roomCalls } = recordingServer();
    disconnectProjectionViewers(server, "share-link", PROJECTION_TOKEN);
    expect(roomCalls[0]?.predicate(PROJECTION_TOKEN, "share-link")).toBe(false);
    expect(roomCalls[0]?.predicate("another-link", "share-link")).toBe(true);
  });
});

describe("disconnectWorkspaceShares", () => {
  const revoked = "revoked-share-token";
  const active = "active-share-token";
  const liveSession = "live-session";
  const deadSession = "dead-session";
  const otherWorkspaceSession = "other-workspace-session";

  function deps(overrides: { verifyThrows?: boolean } = {}) {
    return {
      sourceToken: SOURCE_TOKEN,
      workspaces: {
        verify: (_workspaceId: string, auth: string) => {
          if (overrides.verifyThrows && auth === "malformed") throw new Error("bad key");
          return auth === OWNER_KEY;
        },
      },
      shares: {
        isShareToken: (token: string) => token === revoked || token === active,
        resolve: (token: string) => (token === active ? ({ id: "share-1" } as Share) : null),
        resolveSession: (session: string) => {
          if (session === liveSession) {
            return { id: "share-1", workspaceId: WORKSPACE_ID, revokedAt: null } as Share;
          }
          if (session === otherWorkspaceSession) {
            return { id: "share-2", workspaceId: "ws-2", revokedAt: null } as Share;
          }
          return null;
        },
      },
    };
  }

  it("closes only share credentials that no longer authenticate", () => {
    const { server, roomCalls } = recordingServer();
    expect(disconnectWorkspaceShares(server, WORKSPACE_ID, deps())).toBe(3);
    const call = roomCalls[0];
    expect(call?.roomId).toBe(WORKSPACE_ID);
    expect(call?.predicate(revoked, WORKSPACE_ID)).toBe(true);
  });

  it("keeps the owner key, the source worker and active links", () => {
    const { server, roomCalls } = recordingServer();
    disconnectWorkspaceShares(server, WORKSPACE_ID, deps());
    const predicate = roomCalls[0]?.predicate ?? (() => true);
    expect(predicate(OWNER_KEY, WORKSPACE_ID)).toBe(false);
    expect(predicate(SOURCE_TOKEN, WORKSPACE_ID)).toBe(false);
    expect(predicate(active, WORKSPACE_ID)).toBe(false);
    expect(predicate("", WORKSPACE_ID)).toBe(false);
  });

  // A browser normally joins with the session id it traded the link token for.
  // Revoking the share deletes its sessions, so the socket must close even
  // though the credential is not the raw token.
  it("closes a session whose share was revoked", () => {
    const { server, roomCalls } = recordingServer();
    disconnectWorkspaceShares(server, WORKSPACE_ID, deps());
    const predicate = roomCalls[0]?.predicate ?? (() => true);
    expect(predicate(deadSession, WORKSPACE_ID)).toBe(true);
  });

  it("keeps a live session of the same workspace and ignores another workspace's", () => {
    const { server, roomCalls } = recordingServer();
    disconnectWorkspaceShares(server, WORKSPACE_ID, deps());
    const predicate = roomCalls[0]?.predicate ?? (() => true);
    expect(predicate(liveSession, WORKSPACE_ID)).toBe(false);
    expect(predicate(otherWorkspaceSession, WORKSPACE_ID)).toBe(true);
  });

  // A credential that throws inside owner verification is not an owner, and it
  // resolves to no share and no session: it authenticates nothing, so it closes.
  it("closes a malformed credential that authenticates nothing", () => {
    const { server, roomCalls } = recordingServer();
    disconnectWorkspaceShares(server, WORKSPACE_ID, deps({ verifyThrows: true }));
    expect(roomCalls[0]?.predicate("malformed", WORKSPACE_ID)).toBe(true);
  });
});

describe("disconnectAuthSessions", () => {
  it("closes sessions authenticated with the given credential", () => {
    const { server, authCalls } = recordingServer();
    expect(disconnectAuthSessions(server, "old-owner-key")).toBe(4);
    expect(authCalls).toEqual(["old-owner-key"]);
  });
});

// Real server and real clients: the wrapper talks to the patched SimpleServer,
// which records the auth credential per joined room.
let directory = "";
let shares: ShareStore;
let workspaces: WorkspaceRegistry;
let server: SimpleServer;
let url = "";
const clients: LoroWebsocketClient[] = [];

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      const port = typeof address === "object" && address ? address.port : 0;
      probe.close(() => resolve(port));
    });
  });
}

/** Joins each room over one socket, the way a browser tab holds its rooms. */
async function connect(auth: string, ...roomIds: string[]): Promise<LoroWebsocketClient> {
  const client = new LoroWebsocketClient({ url, reconnect: { enabled: false } });
  clients.push(client);
  const credential = new TextEncoder().encode(auth);
  for (const roomId of roomIds) {
    await client.join({ roomId, crdtAdaptor: new LoroAdaptor(new LoroDoc()), auth: credential });
  }
  return client;
}

async function expectDisconnected(client: LoroWebsocketClient): Promise<void> {
  await vi.waitFor(() => expect(client.getStatus()).toBe("disconnected"), {
    timeout: 2000,
    interval: 20,
  });
}

beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), "suite-room-sockets-"));
  shares = createShareStore(join(directory, "shares.sqlite"));
  workspaces = createWorkspaceRegistry(join(directory, "workspaces.sqlite"));
  workspaces.claimOrVerify(WORKSPACE_ID, OWNER_KEY);

  const port = await freePort();
  server = new SimpleServer({
    port,
    authenticate: (roomId, _crdtType, auth) =>
      authorize(roomId, auth, {
        shares,
        workspaces,
        projectionToken: PROJECTION_TOKEN,
        sourceToken: SOURCE_TOKEN,
      }),
  });
  await server.start();
  url = `ws://127.0.0.1:${port}`;
});

afterEach(async () => {
  for (const client of clients.splice(0)) client.destroy();
  await server.stop();
  shares.close();
  workspaces.close();
  rmSync(directory, { recursive: true, force: true });
});

describe("live kick against a real server", () => {
  it("closes the revoked projection link only", async () => {
    const first = shares.create({
      workspaceId: WORKSPACE_ID,
      scope: "board",
      role: "viewer",
      boardId: BOARD_ID,
    });
    const second = shares.create({
      workspaceId: WORKSPACE_ID,
      scope: "board",
      role: "viewer",
      boardId: BOARD_ID,
    });
    const roomId = first.share.roomId ?? "";
    expect(roomId.startsWith("share-")).toBe(true);

    const worker = await connect(PROJECTION_TOKEN, roomId);
    const viewer = await connect(first.token, roomId);
    const otherLink = await connect(second.token, second.share.roomId ?? "");

    expect(disconnectProjectionViewers(server, roomId, PROJECTION_TOKEN)).toBe(1);

    await expectDisconnected(viewer);
    expect(worker.getStatus()).toBe("connected");
    expect(otherLink.getStatus()).toBe("connected");
  });

  it("closes a revoked workspace link but keeps the owner and the publish worker", async () => {
    // The source token only joins a workspace room that has an editor share.
    shares.create({ workspaceId: WORKSPACE_ID, scope: "board", role: "editor", boardId: BOARD_ID });
    const revoked = shares.create({
      workspaceId: WORKSPACE_ID,
      scope: "workspace",
      role: "viewer",
    });
    const active = shares.create({ workspaceId: WORKSPACE_ID, scope: "workspace", role: "viewer" });

    const owner = await connect(OWNER_KEY, WORKSPACE_ID, `${WORKSPACE_ID}:presence`);
    const worker = await connect(SOURCE_TOKEN, WORKSPACE_ID);
    const viewer = await connect(revoked.token, WORKSPACE_ID, `${WORKSPACE_ID}:presence`);
    const otherViewer = await connect(active.token, WORKSPACE_ID);

    shares.revoke(revoked.share.id);
    expect(shares.resolve(revoked.token)).toBeNull();
    expect(shares.isShareToken(revoked.token)).toBe(true);

    expect(
      disconnectWorkspaceShares(server, WORKSPACE_ID, {
        sourceToken: SOURCE_TOKEN,
        workspaces,
        shares,
      }),
    ).toBe(1);

    await expectDisconnected(viewer);
    expect(owner.getStatus()).toBe("connected");
    expect(worker.getStatus()).toBe("connected");
    expect(otherViewer.getStatus()).toBe("connected");
  });

  it("closes the previous owner's sessions after a rotation", async () => {
    const previous = await connect(OWNER_KEY, WORKSPACE_ID, `${WORKSPACE_ID}:presence`);
    workspaces.rotate(WORKSPACE_ID, OWNER_KEY, "owner-key-2");
    const current = await connect("owner-key-2", WORKSPACE_ID, `${WORKSPACE_ID}:presence`);

    expect(disconnectAuthSessions(server, OWNER_KEY)).toBe(1);

    await expectDisconnected(previous);
    expect(current.getStatus()).toBe("connected");
  });
});

describe("flushDirtyDocuments", () => {
  it("calls the server's flush and reports success", async () => {
    const calls: number[] = [];
    const server = { saveAllDirtyDocuments: async () => void calls.push(1) };
    await expect(flushDirtyDocuments(server)).resolves.toBe(true);
    expect(calls).toHaveLength(1);
  });

  /**
   * The method is not part of the server's declared API, so an upgrade could
   * rename it. The failure must be visible: `false` makes the caller log, rather
   * than a cast that silently does nothing forever.
   */
  it("reports false when the server has no flush", async () => {
    await expect(flushDirtyDocuments({})).resolves.toBe(false);
    await expect(flushDirtyDocuments(null)).resolves.toBe(false);
  });

  it("surfaces a real flush error to the caller", async () => {
    const server = {
      saveAllDirtyDocuments: async () => {
        throw new Error("disk full");
      },
    };
    await expect(flushDirtyDocuments(server)).rejects.toThrow("disk full");
  });
});
