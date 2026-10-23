/**
 * Node, not jsdom: this test opens a real websocket to a real relay, and jsdom's
 * undici-backed WebSocket mixes event realms with the Node EventTarget it
 * extends. The provider has no DOM dependency, so the Node environment is the
 * honest one here.
 *
 * @vitest-environment node
 */
import { createServer } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { WorkspaceDocument } from "@suite/graph";
import { EphemeralStore, LoroDoc, LoroMap, LoroText } from "loro-crdt";
import { SimpleServer } from "loro-websocket/server";
import { afterEach, describe, expect, it } from "vitest";
import { rejoinOnClaim } from "../session/ownerKey";
import { type LoroConnectionStatus, LoroProvider, nextConnectionStatus } from "./loroProvider";

// loro-websocket 0.6.2 rejects its internal connection promise from close()/
// destroy() without attaching a handler. These are teardown-only rejections.
process.on("unhandledRejection", (reason) => {
  if (reason instanceof Error && /^(Destroyed|Disconnected)$/u.test(reason.message)) return;
  throw reason;
});

/**
 * Offline re-join against a real relay, not a fake one.
 *
 * These tests run the same `LoroProvider` the app builds, against
 * `loro-websocket`'s own `SimpleServer`, with an `authenticate` that refuses the
 * room until `claimed` flips — the shape of a workspace that is not claimed
 * yet. Each test asserts both sides of the merge: the provider's local document
 * and the document the server persisted.
 */

const WORKSPACE_ID = "ws-rejoin";
const CARD_ID = "card-rejoin";
/** A card another editor wrote to the relay while this tab was away. */
const SERVER_CARD_ID = "card-on-the-relay";
const TOKEN = "owner-key-rejoin";
const OFFLINE_TEXT = "edited while offline";
const SERVER_TEXT = "written on the relay";
const JOIN_TIMEOUT_MS = 8_000;

interface Harness {
  url: string;
  port: number;
  provider: LoroProvider;
  doc: LoroDoc;
  statuses: LoroConnectionStatus[];
  /** The last document the relay persisted, imported fresh. */
  serverTitle: (cardId?: string) => string | null;
  serverVersion: () => string | null;
}

function freePort(): Promise<number> {
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

async function waitFor(
  check: () => boolean,
  label: string,
  timeoutMs = JOIN_TIMEOUT_MS,
  detail?: () => unknown,
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (check()) return;
    await delay(20);
  }
  throw new Error(`timed out waiting for ${label}${detail ? `: ${JSON.stringify(detail())}` : ""}`);
}

/** A card created locally, then a title the user types while the room is away. */
function seedLocalDoc(doc: LoroDoc): void {
  const workspace = new WorkspaceDocument(doc);
  workspace.createCard({
    id: CARD_ID,
    typeId: "note",
    boardId: workspace.ensureBoard().id,
  });
  doc.commit({ origin: "test:seed" });
}

function appendToTitle(doc: LoroDoc, text: string, cardId = CARD_ID): void {
  const workspace = new WorkspaceDocument(doc);
  const children = workspace.getTitle(cardId).ensureMergeableList("children");
  const paragraph = children.insertContainer(children.length, new LoroMap());
  paragraph.set("nodeName", "paragraph");
  paragraph.ensureMergeableMap("attributes");
  paragraph.ensureMergeableList("children").insertContainer(0, new LoroText()).insert(0, text);
  doc.commit({ origin: "test:offline-edit" });
}

function titleOf(doc: LoroDoc, cardId = CARD_ID): string {
  return new WorkspaceDocument(doc).displayTitle(cardId);
}

/** The relay's copy after another editor already wrote to it. */
function relayCopyWithServerCard(): Uint8Array {
  const doc = new LoroDoc();
  const workspace = new WorkspaceDocument(doc);
  workspace.createCard({
    id: SERVER_CARD_ID,
    typeId: "note",
    boardId: workspace.ensureBoard().id,
  });
  appendToTitle(doc, SERVER_TEXT, SERVER_CARD_ID);
  return doc.export({ mode: "snapshot" });
}

function versionOf(doc: LoroDoc): string {
  return JSON.stringify(
    [...doc.version().toJSON()]
      .map(([peer, counter]) => [String(peer), counter] as const)
      .sort((left, right) => left[0].localeCompare(right[0])),
  );
}

function importSaved(bytes: Uint8Array | null): LoroDoc | null {
  if (bytes === null) return null;
  const doc = new LoroDoc();
  doc.import(bytes);
  return doc;
}

const servers: SimpleServer[] = [];
const providers: LoroProvider[] = [];

afterEach(async () => {
  for (const provider of providers.splice(0)) provider.destroy();
  for (const server of servers.splice(0)) await server.stop().catch(() => undefined);
});

/**
 * Starts a relay that refuses `TOKEN` until `claimed` is true, and records the
 * bytes it persists. `holdNextAuth` lets one test keep a join request in flight.
 */
async function harness(options: { claimed: boolean; seed?: () => Uint8Array | null }): Promise<
  Harness & {
    setClaimed: (value: boolean) => void;
    holdNextAuth: () => void;
    authHeld: () => boolean;
    releaseHeldAuth: () => void;
  }
> {
  const port = await freePort();
  let claimed = options.claimed;
  let holdNextAuth = false;
  let heldResolve: (() => void) | null = null;
  let saved: Uint8Array | null = null;

  const server = new SimpleServer({
    port,
    saveInterval: 25,
    authenticate: async (roomId, _crdt, auth) => {
      if (roomId !== WORKSPACE_ID && !roomId.startsWith(`${WORKSPACE_ID}:`)) return null;
      if (holdNextAuth) {
        holdNextAuth = false;
        await new Promise<void>((resolve) => {
          heldResolve = resolve;
        });
      }
      const token = Buffer.from(auth).toString("utf8");
      return claimed && token === TOKEN ? "write" : null;
    },
    onLoadDocument: async (roomId) => (roomId === WORKSPACE_ID ? (options.seed?.() ?? null) : null),
    onSaveDocument: async (_roomId, _crdt, data) => {
      saved = data;
    },
  });
  servers.push(server);
  await server.start();

  const doc = new LoroDoc();
  seedLocalDoc(doc);
  const statuses: LoroConnectionStatus[] = [];
  const provider = new LoroProvider({
    url: `ws://127.0.0.1:${port}`,
    workspaceId: WORKSPACE_ID,
    doc,
    presence: new EphemeralStore(30_000),
    cursors: new EphemeralStore(30_000),
    auth: new TextEncoder().encode(TOKEN),
    onStatus: (status) => statuses.push(status),
  });
  providers.push(provider);

  return {
    url: `ws://127.0.0.1:${port}`,
    port,
    provider,
    doc,
    statuses,
    serverTitle: (cardId?: string) => {
      const imported = importSaved(saved);
      return imported === null ? null : titleOf(imported, cardId);
    },
    serverVersion: () => {
      const imported = importSaved(saved);
      return imported === null ? null : versionOf(imported);
    },
    setClaimed: (value: boolean) => {
      claimed = value;
    },
    holdNextAuth: () => {
      holdNextAuth = true;
    },
    authHeld: () => heldResolve !== null,
    releaseHeldAuth: () => heldResolve?.(),
  };
}

describe("nextConnectionStatus", () => {
  it("names every transition the provider can report", () => {
    // A fresh page: the socket opens (still Syncing), then the room joins.
    expect(
      nextConnectionStatus("connecting", { type: "transport-connected", everJoined: false }),
    ).toBe("connecting");
    expect(
      nextConnectionStatus("disconnected", { type: "transport-connected", everJoined: true }),
    ).toBe("rejoining");
    expect(nextConnectionStatus("rejoining", { type: "room-joined" })).toBe("connected");
    // A refusal is "offline" in effect: the document stays local.
    expect(nextConnectionStatus("rejoining", { type: "room-refused" })).toBe("disconnected");
    // A drop, then the reconnect timer starting does not flap back to Syncing.
    expect(nextConnectionStatus("connected", { type: "transport-lost" })).toBe("disconnected");
    expect(nextConnectionStatus("disconnected", { type: "transport-connecting" })).toBe(
      "disconnected",
    );
    // A rejoin asked for while offline stays "rejoining" across the retry.
    expect(nextConnectionStatus("disconnected", { type: "rejoin-requested" })).toBe("rejoining");
    expect(nextConnectionStatus("rejoining", { type: "transport-connecting" })).toBe("rejoining");
    // A live room is already where a rejoin wants to be.
    expect(nextConnectionStatus("connected", { type: "rejoin-requested" })).toBe("connected");
  });
});

describe("offline re-join", () => {
  it("rejoins when the connection comes back and the relay receives the offline edit", async () => {
    const h = await harness({ claimed: false });
    await waitFor(() => h.provider.status === "disconnected", "the refused boot join");

    // The user keeps working: this is a local-only edit, the room is not joined.
    appendToTitle(h.doc, OFFLINE_TEXT);
    expect(titleOf(h.doc)).toBe(OFFLINE_TEXT);

    // The relay connection drops and returns. Nothing calls `rejoin()` here: the
    // provider's own connected transition is the trigger, as in a boot that the
    // relay refused and later accepts.
    h.provider.client.socket.close(1000, "test drop");
    h.setClaimed(true);

    await waitFor(() => h.provider.status === "connected", "the rejoin after the reconnect");
    await waitFor(() => h.serverTitle() === OFFLINE_TEXT, "the relay to persist the offline edit");

    expect(h.statuses).toContain("disconnected");
    expect(h.statuses.at(-1)).toBe("connected");
    expect(titleOf(h.doc)).toBe(OFFLINE_TEXT);
  });

  it("rejoins after a claim succeeds where the boot claim failed", async () => {
    const h = await harness({ claimed: false });
    await waitFor(() => h.provider.status === "disconnected", "the refused boot join");

    appendToTitle(h.doc, OFFLINE_TEXT);

    // The retry loop's `claimed` outcome is the production trigger.
    h.setClaimed(true);
    expect(rejoinOnClaim("claimed", h.provider)).toBe(true);

    await waitFor(() => h.serverTitle() === OFFLINE_TEXT, "the relay to receive the edit");
    expect(h.provider.status).toBe("connected");
    // The claim is what reopened the room, so the slot named the reconnect.
    expect(h.statuses).toContain("rejoining");
    // The local document was the source of truth: it was pushed, not replaced.
    expect(titleOf(h.doc)).toBe(OFFLINE_TEXT);
    expect(h.serverVersion()).toBe(versionOf(h.doc));
  });

  it("does not rejoin or write when the claim answers 409", async () => {
    const h = await harness({ claimed: false });
    await waitFor(() => h.provider.status === "disconnected", "the refused boot join");

    appendToTitle(h.doc, OFFLINE_TEXT);
    const statusBefore = h.provider.status;

    // `conflict` is the 409: another key owns the workspace.
    expect(rejoinOnClaim("conflict", h.provider)).toBe(false);
    expect(rejoinOnClaim("pending", h.provider)).toBe(false);
    expect(rejoinOnClaim("offline", h.provider)).toBe(false);

    await delay(250);
    expect(h.provider.status).toBe(statusBefore);
    expect(h.serverTitle()).toBeNull();
    // The local document is intact and untouched.
    expect(titleOf(h.doc)).toBe(OFFLINE_TEXT);
  });

  it("merges a relay copy that is newer than the local one, keeping both sides' work", async () => {
    let relayCopy: Uint8Array | null = null;
    const h = await harness({ claimed: false, seed: () => relayCopy });
    await waitFor(() => h.provider.status === "disconnected", "the refused boot join");

    // The local document changes while the room is away.
    appendToTitle(h.doc, OFFLINE_TEXT);

    // Meanwhile another editor writes to the relay, so its copy is the newer of
    // the two. The rejoin must merge both ways rather than pick a side.
    relayCopy = relayCopyWithServerCard();
    h.setClaimed(true);
    expect(rejoinOnClaim("claimed", h.provider)).toBe(true);

    await waitFor(() => h.provider.status === "connected", "the rejoin");
    await waitFor(
      () => titleOf(h.doc) === OFFLINE_TEXT && titleOf(h.doc, SERVER_CARD_ID) === SERVER_TEXT,
      "the local document to keep its edit and take the relay's",
    );
    await waitFor(
      () => h.serverTitle() === OFFLINE_TEXT && h.serverTitle(SERVER_CARD_ID) === SERVER_TEXT,
      "the relay to keep its edit and take the local one",
    );
    expect(versionOf(h.doc)).toBe(h.serverVersion());
  });

  it("survives a second disconnect during a rejoin without losing or duplicating edits", async () => {
    const h = await harness({ claimed: false });
    await waitFor(() => h.provider.status === "disconnected", "the refused boot join");
    appendToTitle(h.doc, OFFLINE_TEXT);

    // Hold the rejoin's join request inside the server, so the socket can be
    // dropped while the handshake is genuinely in flight.
    h.setClaimed(true);
    h.holdNextAuth();
    const pending = h.provider.rejoin();
    await waitFor(() => h.authHeld(), "the rejoin request to reach the relay");

    h.provider.client.socket.close(1000, "drop during rejoin");
    const detail = () => ({
      status: h.provider.status,
      client: h.provider.client.getStatus(),
      serverTitle: h.serverTitle(),
      serverVersion: h.serverVersion(),
      docVersion: versionOf(h.doc),
      statuses: h.statuses,
    });
    await waitFor(
      () => h.provider.status === "disconnected",
      "the drop during rejoin",
      3000,
      detail,
    );
    h.releaseHeldAuth();
    await pending;

    await waitFor(
      () => h.provider.status === "connected",
      "the rejoin after the second connect",
      6000,
      detail,
    );
    await waitFor(
      () => h.serverTitle() === OFFLINE_TEXT,
      "the relay to persist after the retry",
      6000,
      detail,
    );
    await waitFor(
      () => h.serverVersion() === versionOf(h.doc),
      "both sides to agree on one merged document",
      6000,
      detail,
    );

    // Exactly one copy, on both sides.
    expect(titleOf(h.doc)).toBe(OFFLINE_TEXT);
    expect(h.serverTitle()).toBe(OFFLINE_TEXT);
    expect(versionOf(h.doc)).toBe(h.serverVersion());
  });
});
