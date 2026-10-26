import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createShareStore, type ShareStore } from "../store/shares.js";
import { createWorkspaceRegistry, type WorkspaceRegistry } from "../store/workspaces.js";
import { createRelaySeatGate } from "../sync/seatGate.js";
import { type AuthorizeDeps, authorize, resolveWorkerTokens } from "./auth.js";

const encoder = new TextEncoder();
const PROJECTION_TOKEN = "projection-test-token";
const SOURCE_TOKEN = "source-test-token";
const OWNER_KEY = "owner-key-1";

let directory: string;
let store: ShareStore;
let workspaces: WorkspaceRegistry;
let deps: AuthorizeDeps;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "suite-auth-"));
  store = createShareStore(join(directory, "shares.sqlite"));
  workspaces = createWorkspaceRegistry(join(directory, "workspaces.sqlite"));
  deps = {
    shares: store,
    workspaces,
    projectionToken: PROJECTION_TOKEN,
    sourceToken: SOURCE_TOKEN,
  };
});

afterEach(() => {
  store.close();
  workspaces.close();
  rmSync(directory, { recursive: true, force: true });
});

function encode(token: string): Uint8Array {
  return encoder.encode(token);
}

describe("authorize", () => {
  it("rejects an empty credential everywhere", async () => {
    await expect(authorize("ws-1", new Uint8Array(), deps)).resolves.toBeNull();
    await expect(authorize("ws-1:presence", new Uint8Array(), deps)).resolves.toBeNull();
    await expect(authorize("ws-1:cursors", new Uint8Array(), deps)).resolves.toBeNull();
    await expect(authorize("share-abc", new Uint8Array(), deps)).resolves.toBeNull();
  });

  it("gives an owner key the workspace and its ephemeral rooms", async () => {
    workspaces.claimOrVerify("ws-1", OWNER_KEY);

    await expect(authorize("ws-1", encode(OWNER_KEY), deps)).resolves.toBe("write");
    await expect(authorize("ws-1:presence", encode(OWNER_KEY), deps)).resolves.toBe("write");
    await expect(authorize("ws-1:cursors", encode(OWNER_KEY), deps)).resolves.toBe("write");
  });

  it("never claims an unclaimed workspace on a join", async () => {
    expect(workspaces.has("ws-1")).toBe(false);

    await expect(authorize("ws-1", encode(OWNER_KEY), deps)).resolves.toBeNull();

    expect(workspaces.has("ws-1")).toBe(false);
  });

  it("rejects a different key for an owned workspace", async () => {
    workspaces.claimOrVerify("ws-1", OWNER_KEY);

    await expect(authorize("ws-1", encode("other-key"), deps)).resolves.toBeNull();
    await expect(authorize("ws-1:presence", encode("other-key"), deps)).resolves.toBeNull();
  });

  it("keeps an owner key out of other workspaces and projection rooms", async () => {
    workspaces.claimOrVerify("ws-1", OWNER_KEY);
    workspaces.claimOrVerify("ws-2", "someone-else");

    await expect(authorize("ws-2", encode(OWNER_KEY), deps)).resolves.toBeNull();
    await expect(authorize("share-abc", encode(OWNER_KEY), deps)).resolves.toBeNull();
  });

  it("does not let an owner key claim a projection room", async () => {
    workspaces.claimOrVerify("ws-1", OWNER_KEY);

    await expect(authorize("share-abc", encode(OWNER_KEY), deps)).resolves.toBeNull();
    await expect(authorize("share-abc:presence", encode(OWNER_KEY), deps)).resolves.toBeNull();

    expect(workspaces.has("share-abc")).toBe(false);
  });

  it("lets a workspace viewer read the workspace and write its ephemeral rooms", async () => {
    const { token } = store.create({ workspaceId: "ws-1", scope: "workspace", role: "viewer" });

    await expect(authorize("ws-1", encode(token), deps)).resolves.toBe("read");
    await expect(authorize("ws-1:presence", encode(token), deps)).resolves.toBe("write");
    await expect(authorize("ws-1:cursors", encode(token), deps)).resolves.toBe("write");
  });

  it("gives a workspace editor write access to the workspace room", async () => {
    const { token } = store.create({ workspaceId: "ws-1", scope: "workspace", role: "editor" });

    await expect(authorize("ws-1", encode(token), deps)).resolves.toBe("write");
    await expect(authorize("ws-1:presence", encode(token), deps)).resolves.toBe("write");
  });

  it("does not auto-claim a workspace for a share room", async () => {
    const { token } = store.create({ workspaceId: "ws-1", scope: "workspace", role: "viewer" });

    await expect(authorize("ws-1", encode(token), deps)).resolves.toBe("read");

    expect(workspaces.has("ws-1")).toBe(false);
  });

  it("keeps a workspace share out of other rooms", async () => {
    const { token } = store.create({ workspaceId: "ws-1", scope: "workspace", role: "editor" });

    await expect(authorize("ws-2", encode(token), deps)).resolves.toBeNull();
    await expect(authorize("ws-2:presence", encode(token), deps)).resolves.toBeNull();
    await expect(authorize(`share-${token}`, encode(token), deps)).resolves.toBeNull();
  });

  it("opens the projection room of a board viewer share", async () => {
    const { token } = store.create({
      workspaceId: "ws-1",
      scope: "board",
      role: "viewer",
      boardId: "board-1",
    });

    await expect(authorize(`share-${token}`, encode(token), deps)).resolves.toBe("read");
    await expect(authorize(`share-${token}:presence`, encode(token), deps)).resolves.toBe("write");
    await expect(authorize(`share-${token}:cursors`, encode(token), deps)).resolves.toBe("write");
    await expect(authorize("ws-1", encode(token), deps)).resolves.toBeNull();
    await expect(authorize("share-other", encode(token), deps)).resolves.toBeNull();
  });

  it("supports editor projection rooms even though the API gates them", async () => {
    const { token } = store.create({
      workspaceId: "ws-1",
      scope: "card",
      role: "editor",
      cardId: "card-1",
    });

    await expect(authorize(`share-${token}`, encode(token), deps)).resolves.toBe("write");
    await expect(authorize(`share-${token}:presence`, encode(token), deps)).resolves.toBe("write");
  });

  it("rejects unknown and revoked tokens", async () => {
    await workspaces.claimOrVerify("ws-1", OWNER_KEY);
    const { token, share } = store.create({
      workspaceId: "ws-1",
      scope: "workspace",
      role: "editor",
    });

    await expect(authorize("ws-1", encode("not-a-token"), deps)).resolves.toBeNull();

    store.revoke(share.id);
    await expect(authorize("ws-1", encode(token), deps)).resolves.toBeNull();
  });

  it("limits the projection token to projection rooms", async () => {
    await expect(authorize("share-abc", encode(PROJECTION_TOKEN), deps)).resolves.toBe("write");
    await expect(authorize("share-abc:presence", encode(PROJECTION_TOKEN), deps)).resolves.toBe(
      "write",
    );
    await expect(authorize("ws-1", encode(PROJECTION_TOKEN), deps)).resolves.toBeNull();
  });

  it("limits the source token to workspaces with an active editor share", async () => {
    await expect(authorize("ws-1", encode(SOURCE_TOKEN), deps)).resolves.toBeNull();

    store.create({ workspaceId: "ws-1", scope: "board", role: "editor", boardId: "b-1" });
    await expect(authorize("ws-1", encode(SOURCE_TOKEN), deps)).resolves.toBe("write");
    await expect(authorize("share-abc", encode(SOURCE_TOKEN), deps)).resolves.toBeNull();
  });

  it("does not treat empty worker tokens as a match", async () => {
    const empty: AuthorizeDeps = {
      shares: store,
      workspaces,
      projectionToken: "",
      sourceToken: "",
    };

    await expect(authorize("share-abc", new Uint8Array(), empty)).resolves.toBeNull();
    await expect(authorize("ws-1", new Uint8Array(), empty)).resolves.toBeNull();
    await expect(authorize("ws-1", encode(""), empty)).resolves.toBeNull();
  });

  it("ignores non-UTF8 bytes instead of throwing", async () => {
    await workspaces.claimOrVerify("ws-1", OWNER_KEY);

    await expect(authorize("ws-1", new Uint8Array([0xff, 0xfe]), deps)).resolves.toBeNull();
  });

  it("rejects malformed owner keys without throwing", async () => {
    await expect(authorize("ws-1", encode("x".repeat(600)), deps)).resolves.toBeNull();
  });
});

describe("authorize with an exchanged share session", () => {
  it("opens the same room as its token with the same role", () => {
    const { share } = store.create({ workspaceId: "ws-1", scope: "workspace", role: "viewer" });
    const { session } = store.createSession(share);

    return Promise.all([
      expect(authorize("ws-1", encode(session), deps)).resolves.toBe("read"),
      expect(authorize("ws-1:presence", encode(session), deps)).resolves.toBe("write"),
      expect(authorize("ws-1:cursors", encode(session), deps)).resolves.toBe("write"),
    ]);
  });

  it("gives an editor session write access to its projection room", () => {
    const { share } = store.create({
      workspaceId: "ws-1",
      scope: "card",
      role: "editor",
      cardId: "card-1",
    });
    const { session } = store.createSession(share);
    const roomId = share.roomId ?? "";

    return Promise.all([
      expect(authorize(roomId, encode(session), deps)).resolves.toBe("write"),
      expect(authorize(`${roomId}:presence`, encode(session), deps)).resolves.toBe("write"),
      expect(authorize(roomId, encode("not-a-session"), deps)).resolves.toBeNull(),
    ]);
  });

  it("keeps the raw token path working beside the session", () => {
    const { token, share } = store.create({
      workspaceId: "ws-1",
      scope: "board",
      role: "viewer",
      boardId: "board-1",
    });
    const { session } = store.createSession(share);

    return Promise.all([
      expect(authorize(share.roomId ?? "", encode(token), deps)).resolves.toBe("read"),
      expect(authorize(share.roomId ?? "", encode(session), deps)).resolves.toBe("read"),
    ]);
  });

  it("rejects an expired session", () => {
    const { share } = store.create({ workspaceId: "ws-1", scope: "workspace", role: "viewer" });
    const { session } = store.createSession(share, -1);

    return expect(authorize("ws-1", encode(session), deps)).resolves.toBeNull();
  });

  it("rejects the session of a revoked share", () => {
    const { share } = store.create({ workspaceId: "ws-1", scope: "workspace", role: "editor" });
    const { session } = store.createSession(share);

    store.revoke(share.id);

    return expect(authorize("ws-1", encode(session), deps)).resolves.toBeNull();
  });

  it("does not transfer a session to another share's room", () => {
    const first = store.create({
      workspaceId: "ws-1",
      scope: "board",
      role: "viewer",
      boardId: "board-1",
    });
    const second = store.create({
      workspaceId: "ws-2",
      scope: "board",
      role: "viewer",
      boardId: "board-1",
    });
    const { session } = store.createSession(first.share);

    return Promise.all([
      expect(authorize(first.share.roomId ?? "", encode(session), deps)).resolves.toBe("read"),
      expect(authorize(second.share.roomId ?? "", encode(session), deps)).resolves.toBeNull(),
      expect(
        authorize(second.share.roomId ?? ":presence", encode(session), deps),
      ).resolves.toBeNull(),
      expect(authorize("ws-2", encode(session), deps)).resolves.toBeNull(),
    ]);
  });

  it("never lets a session claim an owner's workspace implicitly", () => {
    workspaces.claimOrVerify("ws-1", OWNER_KEY);
    const { share } = store.create({
      workspaceId: "ws-1",
      scope: "board",
      role: "viewer",
      boardId: "b",
    });
    const { session } = store.createSession(share);

    // The session is scoped to the projection room, not the owner's workspace.
    return expect(authorize("ws-1", encode(session), deps)).resolves.toBeNull();
  });
});

describe("resolveWorkerTokens", () => {
  it("reuses configured tokens and keeps them separate", () => {
    const tokens = resolveWorkerTokens({
      SUITE_PROJECTION_TOKEN: "projection",
      SUITE_SOURCE_TOKEN: "source",
    } as NodeJS.ProcessEnv);

    expect(tokens).toEqual({ projectionToken: "projection", sourceToken: "source" });
  });

  it("generates two different tokens when unset", () => {
    const env = {} as NodeJS.ProcessEnv;
    const tokens = resolveWorkerTokens(env);

    expect(tokens.projectionToken.length).toBeGreaterThanOrEqual(32);
    expect(tokens.sourceToken.length).toBeGreaterThanOrEqual(32);
    expect(tokens.projectionToken).not.toBe(tokens.sourceToken);
    expect(env.SUITE_PROJECTION_TOKEN).toBe(tokens.projectionToken);
    expect(env.SUITE_SOURCE_TOKEN).toBe(tokens.sourceToken);
  });

  it("accepts the legacy internal token only as the projection token", () => {
    const tokens = resolveWorkerTokens({ SUITE_INTERNAL_TOKEN: "legacy" } as NodeJS.ProcessEnv);

    expect(tokens.projectionToken).toBe("legacy");
    expect(tokens.sourceToken).not.toBe("legacy");
  });
});

describe("authorize with the seat gate wired in", () => {
  const NOW = 1_760_000_000_000;
  const lapsedGate = () =>
    createRelaySeatGate({ enforced: true, licenceFor: () => null, now: () => NOW });

  it("is unchanged when no gate is configured, which is every self-host", async () => {
    workspaces.claimOrVerify("ws-1", OWNER_KEY);
    const gate = createRelaySeatGate({
      enforced: false,
      licenceFor: () => null,
      now: () => NOW,
    });
    await expect(authorize("ws-1", encode(OWNER_KEY), { ...deps, seats: gate })).resolves.toBe(
      "write",
    );
  });

  it("drops a credential that the licence no longer covers", async () => {
    workspaces.claimOrVerify("ws-1", OWNER_KEY);
    // No licence row for the workspace: the hosted relay refuses the join even
    // though the owner key is correct, and it opens no socket to explain why.
    await expect(
      authorize("ws-1", encode(OWNER_KEY), { ...deps, seats: lapsedGate() }),
    ).resolves.toBeNull();
  });

  it("leaves the internal worker tokens ungated", async () => {
    const gate = createRelaySeatGate({
      enforced: true,
      licenceFor: () => null,
      now: () => NOW,
    });
    // The projection worker is not a seat: it writes only projection rooms and
    // holding it back on a lapsed licence would leave drafts unpublished.
    await expect(
      authorize("share-abc", encode(PROJECTION_TOKEN), { ...deps, seats: gate }),
    ).resolves.toBe("write");
  });
});
