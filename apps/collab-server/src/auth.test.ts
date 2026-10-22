import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type AuthorizeDeps, authorize, resolveInternalToken } from "./auth.js";
import { createShareStore, type ShareStore } from "./shares.js";
import { createWorkspaceRegistry, type WorkspaceRegistry } from "./workspaces.js";

const encoder = new TextEncoder();
const INTERNAL_TOKEN = "internal-test-token";
const OWNER_KEY = "owner-key-1";

let directory: string;
let store: ShareStore;
let workspaces: WorkspaceRegistry;
let deps: AuthorizeDeps;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "suite-auth-"));
  store = createShareStore(join(directory, "shares.sqlite"));
  workspaces = createWorkspaceRegistry(join(directory, "workspaces.sqlite"));
  deps = { shares: store, workspaces, internalToken: INTERNAL_TOKEN };
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
    await expect(authorize("ws-1", encode(OWNER_KEY), deps)).resolves.toBe("write");
    await expect(authorize("ws-1:presence", encode(OWNER_KEY), deps)).resolves.toBe("write");
    await expect(authorize("ws-1:cursors", encode(OWNER_KEY), deps)).resolves.toBe("write");
  });

  it("claims an unclaimed workspace on the first owner join", async () => {
    expect(workspaces.has("ws-1")).toBe(false);

    await expect(authorize("ws-1", encode(OWNER_KEY), deps)).resolves.toBe("write");

    expect(workspaces.has("ws-1")).toBe(true);
    expect(workspaces.verify("ws-1", OWNER_KEY)).toBe(true);
  });

  it("rejects a different key for an owned workspace", async () => {
    await expect(authorize("ws-1", encode(OWNER_KEY), deps)).resolves.toBe("write");

    await expect(authorize("ws-1", encode("other-key"), deps)).resolves.toBeNull();
    await expect(authorize("ws-1:presence", encode("other-key"), deps)).resolves.toBeNull();
  });

  it("keeps an owner key out of other workspaces and projection rooms", async () => {
    await authorize("ws-1", encode(OWNER_KEY), deps);
    workspaces.claimOrVerify("ws-2", "someone-else");

    await expect(authorize("ws-2", encode(OWNER_KEY), deps)).resolves.toBeNull();
    await expect(authorize("share-abc", encode(OWNER_KEY), deps)).resolves.toBeNull();
  });

  it("does not let an owner key claim a projection room", async () => {
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

  it("lets the internal token write any room", async () => {
    await expect(authorize("ws-1", encode(INTERNAL_TOKEN), deps)).resolves.toBe("write");
    await expect(authorize("share-abc", encode(INTERNAL_TOKEN), deps)).resolves.toBe("write");
    await expect(authorize("ws-1:presence", encode(INTERNAL_TOKEN), deps)).resolves.toBe("write");
  });

  it("does not treat an empty internal token as a match", async () => {
    const empty: AuthorizeDeps = { shares: store, workspaces, internalToken: "" };

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

describe("resolveInternalToken", () => {
  it("reuses a configured token", () => {
    expect(resolveInternalToken("configured")).toBe("configured");
  });

  it("generates and exports a token when unset", () => {
    const previous = process.env.SUITE_INTERNAL_TOKEN;
    const token = resolveInternalToken("");

    expect(token.length).toBeGreaterThanOrEqual(32);
    expect(process.env.SUITE_INTERNAL_TOKEN).toBe(token);

    if (previous === undefined) delete process.env.SUITE_INTERNAL_TOKEN;
    else process.env.SUITE_INTERNAL_TOKEN = previous;
  });
});
