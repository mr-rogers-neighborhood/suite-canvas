import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type AuthorizeDeps, authorize, resolveInternalToken } from "./auth.js";
import { createShareStore, type ShareStore } from "./shares.js";

const encoder = new TextEncoder();
const INTERNAL_TOKEN = "internal-test-token";

let directory: string;
let store: ShareStore;
let deps: AuthorizeDeps;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "suite-auth-"));
  store = createShareStore(join(directory, "shares.sqlite"));
  deps = { shares: store, internalToken: INTERNAL_TOKEN };
});

afterEach(() => {
  store.close();
  rmSync(directory, { recursive: true, force: true });
});

function encode(token: string): Uint8Array {
  return encoder.encode(token);
}

describe("authorize", () => {
  it("lets an unauthenticated owner into a normal room", async () => {
    await expect(authorize("ws-1", new Uint8Array(), deps)).resolves.toBe("write");
  });

  it("leaves presence and cursor rooms writable for the owner", async () => {
    await expect(authorize("ws-1:presence", new Uint8Array(), deps)).resolves.toBe("write");
    await expect(authorize("ws-1:cursors", new Uint8Array(), deps)).resolves.toBe("write");
  });

  it("rejects an unauthenticated join to a share room", async () => {
    await expect(authorize("share-abc", new Uint8Array(), deps)).resolves.toBeNull();
  });

  it("gives a workspace editor write access to the workspace room", async () => {
    const { token } = store.create({ workspaceId: "ws-1", scope: "workspace", role: "editor" });

    await expect(authorize("ws-1", encode(token), deps)).resolves.toBe("write");
  });

  it("keeps a workspace share out of other rooms", async () => {
    const { token } = store.create({ workspaceId: "ws-1", scope: "workspace", role: "editor" });

    await expect(authorize("ws-2", encode(token), deps)).resolves.toBeNull();
    await expect(authorize("ws-1:presence", encode(token), deps)).resolves.toBeNull();
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
  });

  it("rejects unknown and revoked tokens", async () => {
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
    const empty: AuthorizeDeps = { shares: store, internalToken: "" };

    await expect(authorize("share-abc", new Uint8Array(), empty)).resolves.toBeNull();
    await expect(authorize("ws-1", new Uint8Array(), empty)).resolves.toBe("write");
  });

  it("ignores non-UTF8 bytes instead of throwing", async () => {
    await expect(authorize("ws-1", new Uint8Array([0xff, 0xfe]), deps)).resolves.toBeNull();
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
