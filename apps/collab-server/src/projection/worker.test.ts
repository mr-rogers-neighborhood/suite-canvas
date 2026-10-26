import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { setTimeout as delay } from "node:timers/promises";
import { applyProjection, projectWorkspace, WorkspaceDocument } from "@suite/graph";
import { LoroAdaptor } from "loro-adaptors/loro";
import { getType, isContainer, LoroDoc, LoroMap, LoroText } from "loro-crdt";
import { LoroWebsocketClient } from "loro-websocket";
import { SimpleServer } from "loro-websocket/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DocumentStore } from "../store/persistence.js";
import { createShareStore, type Share, type ShareStore } from "../store/shares.js";
import {
  DEFAULT_HOSTED_ROOM_IDLE_HOURS,
  forgetRoomDocument,
  loadLoroDocument,
  loroDocumentKey,
  loroDocumentKeys,
  ProjectionWorker,
  type ProjectionWorkerOptions,
  roomIdleHours,
  roomSessionCount,
} from "./index.js";

// loro-websocket 0.6.2 rejects its internal connection promise from close()/
// destroy() without attaching a handler. These are teardown-only rejections.
process.on("unhandledRejection", (reason) => {
  if (reason instanceof Error && /^(Destroyed|Disconnected)$/u.test(reason.message)) return;
  throw reason;
});

const PROJECTION_TOKEN = "test-projection-token";
const SOURCE_TOKEN = "test-source-token";
const WORKSPACE_ID = "ws-1";
const BOARD_ID = "board-1";

interface Harness {
  server: SimpleServer;
  url: string;
  documents: DocumentStore;
  shares: ShareStore;
  /** Path of the share database, so a test can write a row the API refuses. */
  database: string;
  source: WorkspaceDocument;
  worker: ProjectionWorker;
  warnings: string[];
}

let harness: Harness | null = null;
let directory = "";

function memoryDocuments(): DocumentStore {
  const saved = new Map<string, Uint8Array>();
  return {
    load: (name) => saved.get(name) ?? null,
    save: (name, state) => {
      saved.set(name, state);
    },
    delete: (name) => {
      saved.delete(name);
    },
    close: () => undefined,
  };
}

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

function appendText(container: LoroMap, text: string): void {
  const children = container.ensureMergeableList("children");
  const paragraph = children.insertContainer(children.length, new LoroMap());
  paragraph.set("nodeName", "paragraph");
  paragraph.ensureMergeableMap("attributes");
  paragraph.ensureMergeableList("children").insertContainer(0, new LoroText()).insert(0, text);
}

/**
 * Appends text to the card's **first** paragraph instead of a new one. Two
 * editors changing the same block is a genuine conflict; appending separate
 * paragraphs is not, because publish now keys body changes per block.
 */
function editFirstParagraph(container: LoroMap, text: string): void {
  const children = container.ensureMergeableList("children");
  const first = children.get(0);
  if (!first || !isContainer(first)) throw new Error("no first paragraph to edit");
  const inline = (first as LoroMap).ensureMergeableList("children");
  const target = inline.get(0);
  if (!target || getType(target as never) !== "Text") throw new Error("no text run to edit");
  (target as LoroText).insert((target as LoroText).length, text);
}

function seedSource(): WorkspaceDocument {
  const source = new WorkspaceDocument();
  source.ensureDefaultTypes();
  source.markSeeded();
  const board = source.ensureBoard();
  source.renameBoard(board.id, "Research");
  source.createCard({ id: "a", typeId: "note", boardId: board.id, position: { x: 10, y: 20 } });
  source.createCard({ id: "b", typeId: "note", boardId: board.id, position: { x: 30, y: 40 } });
  source.createCard({ id: "c", typeId: "note" });
  appendText(source.getTitle("a"), "Alpha");
  appendText(source.getContent("a"), "Body of A");
  appendText(source.getTitle("b"), "Beta");
  appendText(source.getTitle("c"), "Gamma");
  source.doc.commit({ origin: "text:body" });
  return source;
}

function saveSource(state: Harness): void {
  state.documents.save(
    loroDocumentKey(WORKSPACE_ID),
    state.source.doc.export({ mode: "snapshot" }),
  );
}

async function startHarness(
  options: {
    seed?: boolean;
    /** Worker settings a test cares about; the rest keep the harness defaults. */
    worker?: Partial<
      Pick<
        ProjectionWorkerOptions,
        "idleHours" | "now" | "roomClients" | "onRoomClosed" | "maxRooms"
      >
    >;
  } = {},
): Promise<Harness> {
  const port = await freePort();
  const documents = memoryDocuments();
  const database = join(directory, "shares.sqlite");
  const shares = createShareStore(database);
  const source = seedSource();
  const warnings: string[] = [];

  const server = new SimpleServer({
    port,
    saveInterval: 50,
    // Mirrors the production server: one normalized key for loads and saves.
    onLoadDocument: async (roomId) => loadLoroDocument(documents, roomId),
    async onSaveDocument(roomId, _crdtType, data) {
      documents.save(loroDocumentKey(roomId), data);
    },
    authenticate: async (roomId, _crdtType, auth) => {
      const token = Buffer.from(auth).toString("utf8");
      if (token === PROJECTION_TOKEN && roomId.startsWith("share-")) return "write";
      if (token === SOURCE_TOKEN && !roomId.startsWith("share-") && shares.hasEditorShare(roomId)) {
        return "write";
      }
      const share = shares.resolve(token);
      if (!share || share.roomId !== roomId) return null;
      return share.role === "editor" ? "write" : "read";
    },
  });
  await server.start();

  const state: Harness = {
    server,
    url: `ws://127.0.0.1:${port}`,
    documents,
    shares,
    database,
    source,
    worker: new ProjectionWorker({
      url: `ws://127.0.0.1:${port}`,
      projectionToken: PROJECTION_TOKEN,
      sourceToken: SOURCE_TOKEN,
      documents,
      shares,
      debounceMs: 60,
      logger: { warn: (text: string) => warnings.push(text) },
      // The real readers, so the sweep tests exercise the patched server's view
      // of who is connected and what it still holds, not stand-ins for it.
      roomClients: (roomId) => roomSessionCount(server, roomId, PROJECTION_TOKEN),
      onRoomClosed: (roomId) => {
        forgetRoomDocument(server, roomId);
      },
      ...options.worker,
    }),
    warnings,
  };
  if (options.seed !== false) saveSource(state);
  harness = state;
  return state;
}

interface Viewer {
  client: LoroWebsocketClient;
  doc: LoroDoc;
  room: Awaited<ReturnType<LoroWebsocketClient["join"]>>;
  workspace: () => WorkspaceDocument;
}

async function openViewer(url: string, roomId: string, token: string): Promise<Viewer> {
  const doc = new LoroDoc();
  const client = new LoroWebsocketClient({ url });
  const adaptor = new LoroAdaptor(doc);
  const room = await client.join({
    roomId,
    crdtAdaptor: adaptor,
    auth: () => new TextEncoder().encode(token),
  });
  return { client, doc, room, workspace: () => new WorkspaceDocument(doc) };
}

/**
 * Starts the worker and opens exactly the rooms a test is looking at, which is
 * what the HTTP share resolve does in production. Boot itself opens nothing:
 * that is the regression this helper exists to make visible.
 */
async function startViewing(state: Harness, ...shares: Share[]): Promise<void> {
  await state.worker.start();
  for (const share of shares) await state.worker.openShare(share);
}

async function waitFor(check: () => boolean, label: string, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (check()) return;
    await delay(25);
  }
  throw new Error(`timed out waiting for ${label}`);
}

function boardCards(viewer: Viewer): string[] {
  return viewer
    .workspace()
    .listBoardCards(BOARD_ID)
    .map((card) => card.id)
    .sort();
}

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "suite-projection-"));
});

afterEach(async () => {
  const state = harness;
  harness = null;
  if (state) {
    await state.worker.stop();
    await state.server.stop();
    state.shares.close();
  }
  rmSync(directory, { recursive: true, force: true });
});

describe("document keys", () => {
  it("keys new writes by the Loro type the server can read back", () => {
    expect(loroDocumentKey("ws-1")).toBe("%LOR:ws-1");
    expect(loroDocumentKeys("ws-1")).toEqual(["%LOR:ws-1", "loro:ws-1", "NaN:ws-1"]);
  });

  it("loads the newest key first and falls back to the earlier ones", () => {
    const documents = memoryDocuments();
    const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);

    expect(loadLoroDocument(documents, "ws-1")).toBeNull();

    documents.save("NaN:ws-1", bytes("nan"));
    expect(loadLoroDocument(documents, "ws-1")).toEqual(bytes("nan"));

    documents.save("loro:ws-1", bytes("loro"));
    expect(loadLoroDocument(documents, "ws-1")).toEqual(bytes("loro"));

    documents.save("%LOR:ws-1", bytes("current"));
    expect(loadLoroDocument(documents, "ws-1")).toEqual(bytes("current"));
  });
});

describe("projection worker", () => {
  it("publishes a board share and follows later saves", async () => {
    const state = await startHarness();
    const { token, share } = state.shares.create({
      workspaceId: WORKSPACE_ID,
      scope: "board",
      role: "viewer",
      boardId: BOARD_ID,
    });
    expect(share.roomId).toBe(`share-${token}`);

    const viewer = await openViewer(state.url, share.roomId as string, token);
    try {
      await startViewing(state, share);
      await waitFor(() => boardCards(viewer).length === 2, "the first projection");

      const projected = viewer.workspace();
      expect(boardCards(viewer)).toEqual(["a", "b"]);
      expect(projected.getBoard(BOARD_ID)?.name).toBe("Research");
      expect(projected.displayTitle("a")).toBe("Alpha");
      expect(projected.cardText("a")).toBe("Body of A");
      expect(projected.getCard("c")).toBeUndefined();

      // Move one card and drop the other from the board.
      state.source.placeCard(BOARD_ID, "a", { x: 500, y: 600 });
      state.source.unplaceCard(BOARD_ID, "b");
      saveSource(state);
      await state.worker.schedule(WORKSPACE_ID, { immediate: true });

      await waitFor(() => boardCards(viewer).length === 1, "the rebuild");
      expect(boardCards(viewer)).toEqual(["a"]);
      expect(viewer.workspace().getPlacement(BOARD_ID, "a")).toMatchObject({ x: 500, y: 600 });
      expect(viewer.workspace().getPlacement(BOARD_ID, "b")).toBeUndefined();
    } finally {
      await viewer.room.leave().catch(() => undefined);
      viewer.client.close();
    }
  });

  it.each([`loro:${WORKSPACE_ID}`, `NaN:${WORKSPACE_ID}`])(
    "projects a workspace saved under the legacy %s key",
    async (key) => {
      const state = await startHarness({ seed: false });
      state.documents.save(key, state.source.doc.export({ mode: "snapshot" }));
      const { token, share } = state.shares.create({
        workspaceId: WORKSPACE_ID,
        scope: "board",
        role: "viewer",
        boardId: BOARD_ID,
      });

      const viewer = await openViewer(state.url, share.roomId as string, token);
      try {
        await startViewing(state, share);
        await waitFor(() => boardCards(viewer).length === 2, "the legacy workspace");
        expect(boardCards(viewer)).toEqual(["a", "b"]);
      } finally {
        await viewer.room.leave().catch(() => undefined);
        viewer.client.close();
      }
    },
  );

  it("publishes a card share without the rest of the board", async () => {
    const state = await startHarness();
    const { token, share } = state.shares.create({
      workspaceId: WORKSPACE_ID,
      scope: "card",
      role: "viewer",
      cardId: "a",
    });

    const viewer = await openViewer(state.url, share.roomId as string, token);
    try {
      await startViewing(state, share);
      await waitFor(() => viewer.workspace().getCard("a") !== undefined, "the card projection");

      const projected = viewer.workspace();
      expect(projected.listCards().map((card) => card.id)).toEqual(["a"]);
      expect(projected.displayTitle("a")).toBe("Alpha");
      expect(projected.getBoard(BOARD_ID)).toBeUndefined();
    } finally {
      await viewer.room.leave().catch(() => undefined);
      viewer.client.close();
    }
  });

  it("retries once the workspace is saved and debounces bursts of saves", async () => {
    const state = await startHarness({ seed: false });
    const { token, share } = state.shares.create({
      workspaceId: WORKSPACE_ID,
      scope: "board",
      role: "viewer",
      boardId: BOARD_ID,
    });

    const viewer = await openViewer(state.url, share.roomId as string, token);
    try {
      await startViewing(state, share);
      expect(boardCards(viewer)).toEqual([]);

      saveSource(state);
      state.source.createCard({
        id: "d",
        typeId: "note",
        boardId: BOARD_ID,
        position: { x: 1, y: 1 },
      });
      saveSource(state);
      await state.worker.schedule(WORKSPACE_ID);

      await waitFor(() => boardCards(viewer).includes("d"), "the debounced rebuild");
      expect(boardCards(viewer)).toEqual(["a", "b", "d"]);
    } finally {
      await viewer.room.leave().catch(() => undefined);
      viewer.client.close();
    }
  });

  it("keeps the last good projection when the shared card is trashed", async () => {
    const state = await startHarness();
    const { token, share } = state.shares.create({
      workspaceId: WORKSPACE_ID,
      scope: "card",
      role: "viewer",
      cardId: "a",
    });

    const viewer = await openViewer(state.url, share.roomId as string, token);
    try {
      await startViewing(state, share);
      await waitFor(() => viewer.workspace().getCard("a") !== undefined, "the card projection");

      state.source.trashCard("a");
      saveSource(state);
      await state.worker.schedule(WORKSPACE_ID, { immediate: true });

      expect(viewer.workspace().getCard("a")).toBeDefined();
      expect(state.warnings.some((text) => text.includes("skipped"))).toBe(true);
      await waitFor(() => state.worker.roomIds().length === 1, "the room to stay open");
    } finally {
      await viewer.room.leave().catch(() => undefined);
      viewer.client.close();
    }
  });

  it("leaves the room when the share is revoked", async () => {
    const state = await startHarness();
    const { share } = state.shares.create({
      workspaceId: WORKSPACE_ID,
      scope: "board",
      role: "viewer",
      boardId: BOARD_ID,
    });

    await startViewing(state, share);
    expect(state.worker.roomIds()).toEqual([share.roomId]);

    state.shares.revoke(share.id);
    await state.worker.schedule(WORKSPACE_ID, { immediate: true });

    expect(state.worker.roomIds()).toEqual([]);
    expect(loadLoroDocument(state.documents, share.roomId as string)).toBeNull();
  });

  it("ignores workspace shares and a missing document store", async () => {
    const state = await startHarness({ seed: false });
    state.shares.create({ workspaceId: WORKSPACE_ID, scope: "workspace", role: "editor" });

    await state.worker.start();

    expect(state.worker.roomIds()).toEqual([]);
    await expect(state.worker.schedule(WORKSPACE_ID, { immediate: true })).resolves.toBeUndefined();
  });
});

describe("lazy rooms", () => {
  /** A board link, a card link and a selection link over the same workspace. */
  function threeShares(state: Harness): {
    board: { share: Share; token: string };
    card: { share: Share; token: string };
    selection: { share: Share; token: string };
  } {
    return {
      board: state.shares.create({
        workspaceId: WORKSPACE_ID,
        scope: "board",
        role: "viewer",
        boardId: BOARD_ID,
      }),
      card: state.shares.create({
        workspaceId: WORKSPACE_ID,
        scope: "card",
        role: "viewer",
        cardId: "a",
      }),
      selection: state.shares.create({
        workspaceId: WORKSPACE_ID,
        scope: "selection",
        role: "viewer",
        boardId: BOARD_ID,
        cardIds: ["a", "b"],
      }),
    };
  }

  it("boots with stored projection shares without opening a single room", async () => {
    const state = await startHarness();
    const stored = Array.from(
      { length: 25 },
      (_, index) =>
        state.shares.create({
          workspaceId: WORKSPACE_ID,
          scope: index % 2 === 0 ? "board" : "card",
          role: "viewer",
          boardId: BOARD_ID,
          cardId: index % 2 === 0 ? null : "a",
        }).share,
    );

    await state.worker.start();

    // The regression: a restart used to load one document per stored link.
    expect(state.worker.roomIds()).toEqual([]);
    expect(state.worker.projectionRooms()).toEqual([]);
    expect(state.worker.projectionStats()).toMatchObject({ open: 0, opened: 0, evicted: 0 });
    for (const share of stored) {
      expect(loadLoroDocument(state.documents, share.roomId as string)).toBeNull();
    }

    // An owner save with nobody looking still opens nothing.
    await state.worker.schedule(WORKSPACE_ID, { immediate: true });
    expect(state.worker.roomIds()).toEqual([]);
  }, 20_000);

  it("opens exactly the room that was asked for, not its workspace's other links", async () => {
    const state = await startHarness();
    const { board, card, selection } = threeShares(state);
    const viewer = await openViewer(state.url, card.share.roomId as string, card.token);
    try {
      await state.worker.start();

      await state.worker.openShare(card.share);

      expect(state.worker.roomIds()).toEqual([card.share.roomId]);
      expect(state.worker.projectionStats()).toMatchObject({ open: 1, opened: 1 });
      expect(state.worker.projectionStats().limit).toBeGreaterThan(0);
      await waitFor(() => viewer.workspace().getCard("a") !== undefined, "the requested card");

      // An owner edit must reach that open room and still must not open the
      // sibling links: a reader of one link does not make the other two live.
      state.source.renameBoard(BOARD_ID, "After the edit");
      appendText(state.source.getContent("a"), "Lazy update");
      state.source.doc.commit({ origin: "owner:edit" });
      saveSource(state);
      await state.worker.schedule(WORKSPACE_ID, { immediate: true });

      await waitFor(
        () => textOf(viewer.workspace(), "a").includes("Lazy update"),
        "the owner edit in the open room",
      );
      expect(state.worker.roomIds()).toEqual([card.share.roomId]);
      expect(state.worker.roomIds()).not.toContain(board.share.roomId);
      expect(state.worker.roomIds()).not.toContain(selection.share.roomId);
      expect(state.worker.projectionStats()).toMatchObject({ opened: 1 });
    } finally {
      await viewer.room.leave().catch(() => undefined);
      viewer.client.close();
    }
  }, 20_000);

  it("evicts the least-recently-used unattached room at the ceiling", async () => {
    let clock = 1_000;
    const state = await startHarness({
      worker: { maxRooms: 2, now: () => clock },
    });
    const { board, card, selection } = threeShares(state);
    await state.worker.start();

    await state.worker.openShare(board.share);
    clock += 1_000;
    await state.worker.openShare(card.share);
    clock += 1_000;
    await state.worker.openShare(selection.share);

    // Board was read longest ago and nobody is attached, so it is the one that
    // goes; the newest room the reader asked for stays.
    expect(state.worker.roomIds()).toEqual([card.share.roomId, selection.share.roomId]);
    expect(state.worker.projectionStats()).toMatchObject({
      open: 2,
      limit: 2,
      opened: 3,
      evicted: 1,
      refused: 0,
    });

    // The evicted link is not revoked: asking for it again reopens it and
    // evicts the next coldest room.
    clock += 1_000;
    await state.worker.openShare(board.share);
    expect(state.worker.roomIds()).toEqual([selection.share.roomId, board.share.roomId]);
    expect(state.worker.projectionStats()).toMatchObject({ evicted: 2 });
    expect(state.shares.get(board.share.id)?.revokedAt).toBeNull();
  }, 20_000);

  it("refuses to open past the ceiling rather than evict a room with a reader", async () => {
    const state = await startHarness({ worker: { maxRooms: 1 } });
    const { board, card } = threeShares(state);
    const viewer = await openViewer(state.url, board.share.roomId as string, board.token);
    try {
      await state.worker.start();
      await state.worker.openShare(board.share);
      await waitFor(() => boardCards(viewer).length === 2, "the first projection");

      await state.worker.openShare(card.share);

      // The reader keeps its live room; the second link is served from what was
      // saved, which is a freshness cost, never a broken link.
      expect(state.worker.roomIds()).toEqual([board.share.roomId]);
      expect(state.worker.projectionRooms()).toHaveLength(1);
      expect(state.worker.projectionStats()).toMatchObject({
        open: 1,
        opened: 1,
        evicted: 0,
        refused: 1,
      });
      expect(state.warnings.some((text) => text.includes("SUITE_PROJECTION_ROOMS_MAX=1"))).toBe(
        true,
      );

      // Once the reader leaves, the same room may be evicted for a newer one.
      await viewer.room.leave().catch(() => undefined);
      viewer.client.close();
      // The worker evicts nothing while a session is attached, so wait for the
      // sync server to drop the reader before asking for the newer room.
      await waitFor(
        () => roomSessionCount(state.server, board.share.roomId as string, PROJECTION_TOKEN) === 0,
        "the reader to leave",
      );
      await state.worker.openShare(card.share);
      expect(state.worker.roomIds()).toEqual([card.share.roomId]);
      expect(state.worker.projectionStats()).toMatchObject({ evicted: 1, open: 1 });
    } finally {
      await viewer.room.leave().catch(() => undefined);
      viewer.client.close();
    }
  }, 20_000);
});

describe("room idle hours", () => {
  it("is off on a self-host and 24 hours on the hosted relay", () => {
    expect(roomIdleHours({}, false)).toBe(0);
    expect(DEFAULT_HOSTED_ROOM_IDLE_HOURS).toBe(24);
    expect(roomIdleHours({}, true)).toBe(24);
  });

  it("reads SUITE_ROOM_IDLE_HOURS, including 0 to switch it off", () => {
    expect(roomIdleHours({ SUITE_ROOM_IDLE_HOURS: "6" }, false)).toBe(6);
    expect(roomIdleHours({ SUITE_ROOM_IDLE_HOURS: " 12 " }, false)).toBe(12);
    expect(roomIdleHours({ SUITE_ROOM_IDLE_HOURS: "0" }, true)).toBe(0);
  });

  it("falls back to the default rather than guessing at a bad value", () => {
    expect(roomIdleHours({ SUITE_ROOM_IDLE_HOURS: "soon" }, true)).toBe(24);
    expect(roomIdleHours({ SUITE_ROOM_IDLE_HOURS: "soon" }, false)).toBe(0);
    expect(roomIdleHours({ SUITE_ROOM_IDLE_HOURS: "-3" }, false)).toBe(0);
  });
});

describe("roomSessionCount", () => {
  const shareRoom = "share-token";
  const worker = "projection-token";

  function syncServer(sessions: { rooms: string[]; auths: Record<string, string> }[]): unknown {
    const clients = new Map<object, { rooms: Set<string>; auths: Map<string, string> }>();
    const sockets: object[] = [];
    for (const session of sessions) {
      const socket = {};
      sockets.push(socket);
      clients.set(socket, {
        rooms: new Set(session.rooms),
        auths: new Map(Object.entries(session.auths)),
      });
    }
    return { wss: { clients: sockets }, clients };
  }

  it("counts viewers and ignores the worker and other rooms", () => {
    const server = syncServer([
      // The projection worker in its own room.
      { rooms: [`${shareRoom}:0`], auths: { [`${shareRoom}:0`]: worker } },
      // A browser that joined the room and its presence stream: one session.
      {
        rooms: [`${shareRoom}:0`, `${shareRoom}:presence`],
        auths: {
          [`${shareRoom}:0`]: "share-token-value",
          [`${shareRoom}:presence`]: "share-token-value",
        },
      },
      // An unrelated workspace room.
      { rooms: ["ws-1:0"], auths: { "ws-1:0": "owner-key" } },
    ]);

    expect(roomSessionCount(server, shareRoom, worker)).toBe(1);
  });

  it("counts a viewer that only opened a presence room", () => {
    const server = syncServer([
      { rooms: [`${shareRoom}:presence`], auths: { [`${shareRoom}:presence`]: "viewer" } },
    ]);
    expect(roomSessionCount(server, shareRoom, worker)).toBe(1);
  });

  it("returns null when the sync server cannot be read", () => {
    expect(roomSessionCount({}, shareRoom, worker)).toBeNull();
    expect(roomSessionCount(null, shareRoom, worker)).toBeNull();
  });
});

describe("idle room sweep", () => {
  const HOUR = 60 * 60 * 1000;

  async function idleEditorRoom(idleHours: number) {
    let clock = Date.now();
    const state = await startHarness({ worker: { idleHours, now: () => clock } });
    const { share } = state.shares.create({
      workspaceId: WORKSPACE_ID,
      scope: "board",
      role: "editor",
      boardId: BOARD_ID,
    });
    const roomId = share.roomId as string;
    await startViewing(state, share);
    // An editor room keeps a draft baseline, so the sweep has both artefacts to
    // drop: the projected document and the baseline row.
    await waitFor(() => state.shares.getBaseline(share.id) !== null, "the draft baseline");
    await waitForSaved(state, roomId, () => true, "the projected document");
    return { state, share, roomId, advance: (ms: number) => (clock += ms) };
  }

  it("sweeps an idle room and deletes its documents and baseline", async () => {
    const { state, share, roomId, advance } = await idleEditorRoom(1);
    advance(2 * HOUR);

    const report = await state.worker.sweepIdle();

    expect(report).toEqual({
      idleHours: 1,
      dryRun: false,
      checked: 1,
      unknown: 0,
      rooms: [{ roomId, shareId: share.id, workspaceId: WORKSPACE_ID, idleMs: 2 * HOUR }],
    });
    expect(state.worker.roomIds()).toEqual([]);
    expect(loadLoroDocument(state.documents, roomId)).toBeNull();
    expect(state.shares.getBaseline(share.id)).toBeNull();
    expect(state.shares.get(share.id)?.revokedAt).toBeTypeOf("number");
    // The sync server's in-memory copy is the largest part of a dead room.
    const roomKeys = [...(state.server as unknown as { rooms: Map<string, unknown> }).rooms.keys()];
    expect(roomKeys.filter((key) => key.startsWith(`${roomId}:`))).toEqual([]);
  }, 20_000);

  it("reports a dry run's candidates without closing them", async () => {
    const { state, share, roomId, advance } = await idleEditorRoom(1);
    advance(2 * HOUR);

    const report = await state.worker.sweepIdle({ dryRun: true });

    expect(report).toMatchObject({ idleHours: 1, dryRun: true, checked: 1, unknown: 0 });
    expect(report.rooms.map((room) => room.roomId)).toEqual([roomId]);
    expect(state.worker.roomIds()).toEqual([roomId]);
    expect(state.shares.get(share.id)?.revokedAt).toBeNull();
    expect(state.shares.getBaseline(share.id)).not.toBeNull();
  }, 20_000);

  it("keeps a room a viewer is still connected to", async () => {
    let clock = Date.now();
    const state = await startHarness({ worker: { idleHours: 1, now: () => clock } });
    const { token, share } = state.shares.create({
      workspaceId: WORKSPACE_ID,
      scope: "board",
      role: "viewer",
      boardId: BOARD_ID,
    });
    const viewer = await openViewer(state.url, share.roomId as string, token);
    try {
      await startViewing(state, share);
      await waitFor(() => boardCards(viewer).length === 2, "the projection");

      clock += 5 * HOUR;
      const report = await state.worker.sweepIdle();

      expect(report).toMatchObject({ checked: 1, unknown: 0, rooms: [] });
      expect(state.worker.roomIds()).toEqual([share.roomId]);
      expect(state.shares.get(share.id)?.revokedAt).toBeNull();
    } finally {
      await viewer.room.leave().catch(() => undefined);
      viewer.client.close();
    }
  }, 20_000);

  it("keeps a room whose sessions cannot be read", async () => {
    let clock = Date.now();
    const state = await startHarness({
      worker: { idleHours: 1, now: () => clock, roomClients: () => null },
    });
    const { share } = state.shares.create({
      workspaceId: WORKSPACE_ID,
      scope: "board",
      role: "viewer",
      boardId: BOARD_ID,
    });
    await startViewing(state, share);

    clock += 5 * HOUR;
    const report = await state.worker.sweepIdle();

    expect(report).toMatchObject({ checked: 1, unknown: 1, rooms: [] });
    expect(state.worker.roomIds()).toEqual([share.roomId]);
  }, 20_000);

  it("sweeps nothing while the idle window is off", async () => {
    let clock = Date.now();
    const state = await startHarness({ worker: { idleHours: 0, now: () => clock } });
    const { share } = state.shares.create({
      workspaceId: WORKSPACE_ID,
      scope: "board",
      role: "viewer",
      boardId: BOARD_ID,
    });
    await startViewing(state, share);
    expect(state.worker.roomIds()).toHaveLength(1);

    clock += 1000 * HOUR;
    const report = await state.worker.sweepIdle();

    expect(report).toEqual({ idleHours: 0, dryRun: false, checked: 0, unknown: 0, rooms: [] });
    expect(state.worker.roomIds()).toHaveLength(1);
  }, 20_000);
});

describe("selection shares", () => {
  async function openSelection(
    cardIds: readonly string[],
  ): Promise<{ state: Harness; share: Share; viewer: Viewer }> {
    const state = await startHarness();
    const { token, share } = state.shares.create({
      workspaceId: WORKSPACE_ID,
      scope: "selection",
      role: "viewer",
      boardId: BOARD_ID,
      cardIds,
    });
    expect(share.roomId).toBe(`share-${token}`);
    const viewer = await openViewer(state.url, share.roomId as string, token);
    return { state, share, viewer };
  }

  it("projects only the selected cards, their placements and the edges between them", async () => {
    const state = await startHarness();
    // A third placed card proves the projection is a subset of the board.
    state.source.placeCard(BOARD_ID, "c", { x: 50, y: 60 });
    state.source.addEdge({ boardId: BOARD_ID, source: "a", target: "b" });
    saveSource(state);
    const { token, share } = state.shares.create({
      workspaceId: WORKSPACE_ID,
      scope: "selection",
      role: "viewer",
      boardId: BOARD_ID,
      cardIds: ["a", "b"],
    });

    const viewer = await openViewer(state.url, share.roomId as string, token);
    try {
      await startViewing(state, share);
      await waitFor(() => boardCards(viewer).length === 2, "the selection projection");

      const projected = viewer.workspace();
      expect(boardCards(viewer)).toEqual(["a", "b"]);
      expect(
        projected
          .listCards()
          .map((card) => card.id)
          .sort(),
      ).toEqual(["a", "b"]);
      expect(projected.getCard("c")).toBeUndefined();
      // The selection keeps the real board, not a stand-in like a card share.
      expect(projected.getBoard(BOARD_ID)?.name).toBe("Research");
      expect(projected.displayTitle("a")).toBe("Alpha");
      expect(projected.cardText("a")).toBe("Body of A");
      expect(projected.getPlacement(BOARD_ID, "a")).toMatchObject({ x: 10, y: 20 });
      expect(projected.getPlacement(BOARD_ID, "b")).toMatchObject({ x: 30, y: 40 });
      expect(projected.getPlacement(BOARD_ID, "c")).toBeUndefined();
      expect(
        projected.listBoardEdges(BOARD_ID).map((edge) => `${edge.source}->${edge.target}`),
      ).toEqual(["a->b"]);
    } finally {
      await viewer.room.leave().catch(() => undefined);
      viewer.client.close();
    }
  });

  it("follows an owner edit to a selected card", async () => {
    const { state, share, viewer } = await openSelection(["a", "b"]);
    try {
      await startViewing(state, share);
      await waitFor(() => boardCards(viewer).length === 2, "the selection projection");

      appendText(state.source.getContent("a"), "Selection update");
      state.source.doc.commit({ origin: "owner:edit" });
      saveSource(state);
      await state.worker.schedule(WORKSPACE_ID, { immediate: true });

      await waitFor(
        () => textOf(viewer.workspace(), "a").includes("Selection update"),
        "the owner edit in the selection",
      );
      // The rest of the selection still follows the source.
      expect(boardCards(viewer)).toEqual(["a", "b"]);
      expect(viewer.workspace().displayTitle("b")).toBe("Beta");
    } finally {
      await viewer.room.leave().catch(() => undefined);
      viewer.client.close();
    }
  });

  it("drops a selected card that leaves the board and keeps the rest", async () => {
    const { state, share, viewer } = await openSelection(["a", "b"]);
    try {
      await startViewing(state, share);
      await waitFor(() => boardCards(viewer).length === 2, "the selection projection");

      state.source.trashCard("a");
      saveSource(state);
      await state.worker.schedule(WORKSPACE_ID, { immediate: true });

      await waitFor(() => boardCards(viewer).length === 1, "the trashed card to leave");
      expect(boardCards(viewer)).toEqual(["b"]);
      expect(viewer.workspace().getCard("a")).toBeUndefined();
      expect(viewer.workspace().displayTitle("b")).toBe("Beta");

      state.source.unplaceCard(BOARD_ID, "b");
      saveSource(state);
      await state.worker.schedule(WORKSPACE_ID, { immediate: true });

      await waitFor(() => boardCards(viewer).length === 0, "the moved card to leave");
      expect(viewer.workspace().listCards()).toEqual([]);
      expect(viewer.workspace().getPlacement(BOARD_ID, "b")).toBeUndefined();
    } finally {
      await viewer.room.leave().catch(() => undefined);
      viewer.client.close();
    }
  });

  it("refuses a hand-written editor selection link without touching the source", async () => {
    const state = await startHarness();
    // The API only creates viewer selection links, so write the row it refuses.
    const database = new DatabaseSync(state.database);
    try {
      database
        .prepare(
          `INSERT INTO shares (id, token_hash, scope, role, workspace_id, board_id, card_id, created_at, revoked_at, expires_at, room_id, card_ids)
           VALUES (?, ?, 'selection', 'editor', ?, ?, NULL, ?, NULL, NULL, ?, ?)`,
        )
        .run(
          "manual-editor",
          "manual-editor-hash",
          WORKSPACE_ID,
          BOARD_ID,
          Date.now(),
          "share-manual",
          JSON.stringify(["a", "b"]),
        );
    } finally {
      database.close();
    }
    const share = state.shares.get("manual-editor");
    if (!share) throw new Error("expected the hand-written selection share");

    await startViewing(state, share);
    expect(state.worker.roomIds()).toContain("share-manual");
    const before = savedVersion(state.documents, WORKSPACE_ID);

    expect(await state.worker.publish(share)).toEqual({
      ok: false,
      conflicts: [],
      unsupported: [],
      reason: "Selection links are read-only.",
    });

    await delay(100);
    expect(savedVersion(state.documents, WORKSPACE_ID)).toBe(before);
    expect(
      state.source
        .listCards()
        .map((card) => card.id)
        .sort(),
    ).toEqual(["a", "b", "c"]);
    expect(textOf(state.source, "a")).toBe("Body of A");
  });

  it("reports no draft for a selection viewer", async () => {
    const { state, share } = await openSelection(["a", "b"]);
    await startViewing(state, share);
    await waitFor(
      () => state.worker.roomIds().includes(share.roomId as string),
      "the selection room",
    );

    expect(await state.worker.status(share)).toEqual({ dirty: false, hasBaseline: false });
  });

  it("closes the room and drops the projection when a selection share is revoked", async () => {
    const state = await startHarness();
    const { share } = state.shares.create({
      workspaceId: WORKSPACE_ID,
      scope: "selection",
      role: "viewer",
      boardId: BOARD_ID,
      cardIds: ["a", "b"],
    });

    await startViewing(state, share);
    expect(state.worker.roomIds()).toEqual([share.roomId]);

    state.shares.revoke(share.id);
    await state.worker.schedule(WORKSPACE_ID, { immediate: true });

    expect(state.worker.roomIds()).toEqual([]);
    expect(loadLoroDocument(state.documents, share.roomId as string)).toBeNull();
  });
});

function createWorker(
  state: Pick<Harness, "url" | "documents" | "shares" | "warnings">,
): ProjectionWorker {
  return new ProjectionWorker({
    url: state.url,
    projectionToken: PROJECTION_TOKEN,
    sourceToken: SOURCE_TOKEN,
    documents: state.documents,
    shares: state.shares,
    debounceMs: 60,
    logger: { warn: (text: string) => state.warnings.push(text) },
  });
}

/** A workspace rebuilt from what the sync server last saved for a room. */
function savedWorkspace(documents: DocumentStore, roomId: string): WorkspaceDocument | null {
  const state = loadLoroDocument(documents, roomId);
  if (!state) return null;
  const doc = new LoroDoc();
  try {
    doc.import(state);
  } catch {
    return null;
  }
  return new WorkspaceDocument(doc);
}

/** Canonical version vector of what the server last saved for a room. */
function savedVersion(documents: DocumentStore, roomId: string): string | null {
  const state = loadLoroDocument(documents, roomId);
  if (!state) return null;
  const doc = new LoroDoc();
  try {
    doc.import(state);
  } catch {
    return null;
  }
  const entries = [...doc.version().toJSON()].map(
    ([peer, counter]) => [String(peer), counter] as const,
  );
  entries.sort((left, right) => left[0].localeCompare(right[0]));
  return JSON.stringify(entries);
}

async function waitForSaved(
  state: Harness,
  roomId: string,
  check: (workspace: WorkspaceDocument) => boolean,
  label: string,
): Promise<void> {
  await waitFor(() => {
    const workspace = savedWorkspace(state.documents, roomId);
    return workspace !== null && check(workspace);
  }, label);
}

function textOf(workspace: WorkspaceDocument, cardId: string): string {
  return workspace.cardText(cardId);
}

/** Polls the worker until its status predicate holds. */
async function waitForStatus(
  worker: ProjectionWorker,
  share: Share,
  check: (status: { dirty: boolean; hasBaseline: boolean }) => boolean,
  label: string,
): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (check(await worker.status(share))) return;
    await delay(25);
  }
  throw new Error(`timed out waiting for ${label}`);
}

async function openEditor(state: Harness, shareRoomId: string, token: string): Promise<Viewer> {
  return openViewer(state.url, shareRoomId, token);
}

describe("editor shares", () => {
  async function editorHarness(options: { field?: boolean } = {}) {
    const state = await startHarness();
    const fieldId = options.field
      ? state.source.addField("note", { name: "Status", kind: "text" }).id
      : undefined;
    if (fieldId) saveSource(state);
    const { token, share } = state.shares.create({
      workspaceId: WORKSPACE_ID,
      scope: "board",
      role: "editor",
      boardId: BOARD_ID,
    });
    const roomId = share.roomId as string;
    const owner = await openViewer(state.url, WORKSPACE_ID, SOURCE_TOKEN);
    const editor = await openEditor(state, roomId, token);
    await startViewing(state, share);
    await waitFor(() => boardCards(editor).length === 2, "the editor projection");
    await waitFor(() => owner.workspace().getCard("a") !== undefined, "the owner copy");
    return { state, token, share, roomId, owner, editor, fieldId };
  }

  async function closeOwnerAndEditor(owner: Viewer, editor: Viewer): Promise<void> {
    for (const viewer of [owner, editor]) {
      await viewer.room.leave().catch(() => undefined);
      try {
        viewer.client.close();
      } catch {
        // The client already closed itself; nothing left to release.
      }
    }
  }

  it("publishes an editor's layout, body and property changes", async () => {
    const { state, share, roomId, owner, editor, fieldId } = await editorHarness({ field: true });
    try {
      const draft = editor.workspace();
      expect(fieldId).toBeDefined();

      draft.placeCard(BOARD_ID, "a", { x: 400, y: 300 });
      appendText(draft.getContent("a"), "Editor note");
      if (fieldId) draft.setProperty("a", fieldId, "Doing");
      editor.doc.commit({ origin: "editor:edit" });

      await waitForSaved(
        state,
        roomId,
        (workspace) => workspace.getPlacement(BOARD_ID, "a")?.x === 400,
        "the editor update on the server",
      );

      const result = await state.worker.publish(share);
      expect(result).toEqual({ ok: true, applied: 3 });

      await waitFor(
        () => owner.workspace().getPlacement(BOARD_ID, "a")?.x === 400,
        "the owner to receive the placement",
      );
      await waitFor(
        () => textOf(owner.workspace(), "a").includes("Editor note"),
        "the owner to receive the body",
      );
      if (fieldId) {
        expect(owner.workspace().getCard("a")?.properties[fieldId]).toBe("Doing");
      }

      // The share room shows the rebuilt projection, too.
      await waitFor(
        () => editor.workspace().getPlacement(BOARD_ID, "a")?.x === 400,
        "the rebuilt projection",
      );
      expect(textOf(editor.workspace(), "a")).toContain("Editor note");
    } finally {
      await closeOwnerAndEditor(owner, editor);
    }
  }, 20_000);

  it("keeps a dirty draft when the owner saves, then reconciles on publish", async () => {
    const { state, share, roomId, owner, editor } = await editorHarness();
    try {
      editor.workspace().placeCard(BOARD_ID, "a", { x: 500, y: 600 });
      editor.doc.commit({ origin: "editor:edit" });
      await waitForSaved(
        state,
        roomId,
        (workspace) => workspace.getPlacement(BOARD_ID, "a")?.x === 500,
        "the draft on the server",
      );

      appendText(owner.workspace().getContent("b"), "Owner note");
      owner.doc.commit({ origin: "owner:edit" });
      await waitForSaved(
        state,
        WORKSPACE_ID,
        (workspace) => textOf(workspace, "b").includes("Owner note"),
        "the owner write on the server",
      );

      // An owner save must not overwrite the editor's draft.
      await state.worker.schedule(WORKSPACE_ID, { immediate: true });
      expect(editor.workspace().getPlacement(BOARD_ID, "a")?.x).toBe(500);
      expect(textOf(editor.workspace(), "b")).not.toContain("Owner note");

      const result = await state.worker.publish(share);
      expect(result).toEqual({ ok: true, applied: 1 });

      await waitFor(
        () => textOf(editor.workspace(), "b").includes("Owner note"),
        "the pending owner change after publish",
      );
      expect(editor.workspace().getPlacement(BOARD_ID, "a")).toMatchObject({ x: 500, y: 600 });
      await waitFor(
        () => owner.workspace().getPlacement(BOARD_ID, "a")?.x === 500,
        "the published placement on the owner",
      );
    } finally {
      await closeOwnerAndEditor(owner, editor);
    }
  }, 20_000);

  it("rejects a conflicting publish and leaves the source untouched", async () => {
    const { state, share, roomId, owner, editor } = await editorHarness();
    try {
      editFirstParagraph(owner.workspace().getContent("a"), " Owner text");
      owner.doc.commit({ origin: "owner:edit" });
      await waitForSaved(
        state,
        WORKSPACE_ID,
        (workspace) => textOf(workspace, "a").includes("Owner text"),
        "the owner write on the server",
      );

      editFirstParagraph(editor.workspace().getContent("a"), " Editor text");
      editor.doc.commit({ origin: "editor:edit" });
      await waitForSaved(
        state,
        roomId,
        (workspace) => textOf(workspace, "a").includes("Editor text"),
        "the draft on the server",
      );

      const result = await state.worker.publish(share);
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("expected a rejected publish");
      // The key names the block, not the whole body: a per-block conflict.
      const keys = result.conflicts.map((conflict) => conflict.key);
      expect(keys.some((key) => key.startsWith("card:a:body"))).toBe(true);
      expect(result.conflicts[0]?.label).toBeTruthy();
      expect(result.unsupported).toEqual([]);

      expect(textOf(owner.workspace(), "a")).toContain("Owner text");
      expect(textOf(owner.workspace(), "a")).not.toContain("Editor text");
      expect(textOf(editor.workspace(), "a")).toContain("Editor text");

      // Reload is the discard path: the owner's version replaces the draft.
      const reloaded = await state.worker.reload(share);
      expect(reloaded.ok).toBe(true);
      await waitFor(
        () => textOf(editor.workspace(), "a").includes("Owner text"),
        "the reloaded body",
      );
      expect(textOf(editor.workspace(), "a")).not.toContain("Editor text");
    } finally {
      await closeOwnerAndEditor(owner, editor);
    }
  }, 20_000);

  it("reports whether the draft has unpublished changes", async () => {
    const { state, share, owner, editor } = await editorHarness();
    try {
      expect(await state.worker.status(share)).toEqual({ dirty: false, hasBaseline: true });

      appendText(editor.workspace().getContent("a"), "Editor text");
      editor.doc.commit({ origin: "editor:edit" });
      await waitForStatus(
        state.worker,
        share,
        (status) => status.dirty,
        "the draft to read as dirty",
      );

      expect((await state.worker.publish(share)).ok).toBe(true);
      await waitForStatus(
        state.worker,
        share,
        (status) => !status.dirty,
        "the draft to read as published",
      );
      expect(await state.worker.status(share)).toEqual({ dirty: false, hasBaseline: true });
    } finally {
      await closeOwnerAndEditor(owner, editor);
    }
  }, 20_000);

  it("opens a room on demand to answer status", async () => {
    const state = await startHarness();
    await state.worker.start();
    const { token, share } = state.shares.create({
      workspaceId: WORKSPACE_ID,
      scope: "board",
      role: "editor",
      boardId: BOARD_ID,
    });
    expect(state.worker.roomIds()).toEqual([]);

    // The share was created after the worker started; status must join it, and
    // a room opened for a reader is projected before the read settles.
    expect(await state.worker.status(share)).toEqual({ dirty: false, hasBaseline: true });
    expect(state.worker.roomIds()).toContain(share.roomId as string);

    // A viewer has no draft of its own, even with an open projection room.
    const viewer = state.shares.create({
      workspaceId: WORKSPACE_ID,
      scope: "board",
      role: "viewer",
      boardId: BOARD_ID,
    });
    expect(await state.worker.status(viewer.share)).toEqual({
      dirty: false,
      hasBaseline: false,
    });
    expect(token).toBeTruthy();
  }, 20_000);

  it("publishes only the selected conflict and keeps the workspace value for the rest", async () => {
    const { state, share, roomId, owner, editor } = await editorHarness();
    try {
      const draft = editor.workspace();
      draft.placeCard(BOARD_ID, "a", { x: 500, y: 600 });
      editFirstParagraph(draft.getContent("a"), " Editor text");
      editor.doc.commit({ origin: "editor:edit" });
      await waitForSaved(
        state,
        roomId,
        (workspace) =>
          workspace.getPlacement(BOARD_ID, "a")?.x === 500 &&
          textOf(workspace, "a").includes("Editor"),
        "the editor's draft on the server",
      );

      owner.workspace().placeCard(BOARD_ID, "a", { x: 700, y: 800 });
      editFirstParagraph(owner.workspace().getContent("a"), " Owner text");
      owner.doc.commit({ origin: "owner:edit" });
      await waitForSaved(
        state,
        WORKSPACE_ID,
        (workspace) =>
          workspace.getPlacement(BOARD_ID, "a")?.x === 700 &&
          textOf(workspace, "a").includes("Owner"),
        "the owner's edit on the server",
      );

      const result = await state.worker.publish(share, undefined, ["card:a:body"]);
      expect(result).toEqual({ ok: true, applied: 1 });

      // The selected body wins; the unselected placement keeps the workspace move.
      await waitFor(
        () => textOf(owner.workspace(), "a").includes("Editor text"),
        "the selected body on the owner",
      );
      expect(textOf(owner.workspace(), "a")).not.toContain("Owner text");
      expect(owner.workspace().getPlacement(BOARD_ID, "a")).toMatchObject({ x: 700, y: 800 });

      await waitForStatus(
        state.worker,
        share,
        (status) => !status.dirty,
        "the merged draft to be clean",
      );
      await waitFor(
        () => editor.workspace().getPlacement(BOARD_ID, "a")?.x === 700,
        "the workspace placement in the rebuilt draft",
      );
    } finally {
      await closeOwnerAndEditor(owner, editor);
    }
  }, 20_000);

  it("keeps unsupported changes blocking a conflict-resolving publish", async () => {
    const { state, share, owner, editor } = await editorHarness();
    try {
      editor.workspace().placeCard(BOARD_ID, "a", { x: 500, y: 600 });
      // An unplaced new card is still outside what a board editor may publish.
      editor.workspace().createCard();
      editor.doc.commit({ origin: "editor:edit" });

      owner.workspace().placeCard(BOARD_ID, "a", { x: 700, y: 800 });
      owner.doc.commit({ origin: "owner:edit" });
      await waitForSaved(
        state,
        WORKSPACE_ID,
        (workspace) => workspace.getPlacement(BOARD_ID, "a")?.x === 700,
        "the owner's edit on the server",
      );

      const result = await state.worker.publish(share, undefined, [`board:${BOARD_ID}:card:a`]);
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("expected a rejected publish");
      expect(result.unsupported.length).toBeGreaterThan(0);
      expect(owner.workspace().getPlacement(BOARD_ID, "a")).toMatchObject({ x: 700, y: 800 });
    } finally {
      await closeOwnerAndEditor(owner, editor);
    }
  }, 20_000);

  it("reloads a draft back to the workspace version", async () => {
    const { state, share, roomId, owner, editor } = await editorHarness();
    try {
      editor.workspace().placeCard(BOARD_ID, "a", { x: 700, y: 800 });
      editor.doc.commit({ origin: "editor:edit" });
      await waitForSaved(
        state,
        roomId,
        (workspace) => workspace.getPlacement(BOARD_ID, "a")?.x === 700,
        "the draft on the server",
      );

      expect(await state.worker.reload(share)).toEqual({ ok: true, applied: 1 });

      await waitFor(
        () => editor.workspace().getPlacement(BOARD_ID, "a")?.x === 10,
        "the workspace placement",
      );
      expect(editor.workspace().getPlacement(BOARD_ID, "a")).toMatchObject({ x: 10, y: 20 });
    } finally {
      await closeOwnerAndEditor(owner, editor);
    }
  }, 20_000);

  it("restores a dirty draft and its baseline after a worker restart", async () => {
    const { state, share, roomId, owner, editor } = await editorHarness();
    try {
      editor.workspace().placeCard(BOARD_ID, "a", { x: 440, y: 550 });
      editor.doc.commit({ origin: "editor:edit" });
      await waitForSaved(
        state,
        roomId,
        (workspace) => workspace.getPlacement(BOARD_ID, "a")?.x === 440,
        "the draft on the server",
      );

      await state.worker.stop();
      state.worker = createWorker(state);
      // A restart is lazy: the room reopens when the editor comes back, not
      // because its row exists.
      await startViewing(state, share);
      await waitFor(() => state.worker.roomIds().includes(roomId), "the reopened room");

      // The draft survived: the persisted baseline made it dirty again.
      await delay(100);
      expect(editor.workspace().getPlacement(BOARD_ID, "a")?.x).toBe(440);

      const result = await state.worker.publish(share);
      expect(result).toEqual({ ok: true, applied: 1 });
      await waitFor(
        () => owner.workspace().getPlacement(BOARD_ID, "a")?.x === 440,
        "the published placement after restart",
      );
    } finally {
      await closeOwnerAndEditor(owner, editor);
    }
  }, 20_000);

  it("does not freeze a restarted room whose history advanced without draft edits", async () => {
    const { state, share, roomId, owner, editor } = await editorHarness();
    try {
      await state.worker.stop();

      // Someone rewrites the room with the same projection: every value matches
      // the baseline, but the room version advances past it.
      const historyBefore = savedVersion(state.documents, roomId);
      const rewriter = await openViewer(state.url, roomId, PROJECTION_TOKEN);
      try {
        applyProjection(
          rewriter.workspace(),
          projectWorkspace(state.source, { scope: "board", boardId: BOARD_ID }).workspace,
        );
        rewriter.doc.commit({ origin: "owner:projection" });
        await waitFor(
          () => savedVersion(state.documents, roomId) !== historyBefore,
          "the room history to advance",
        );
      } finally {
        await rewriter.room.leave().catch(() => undefined);
        rewriter.client.close();
      }

      state.worker = createWorker(state);
      await startViewing(state, share);
      await waitFor(() => state.worker.roomIds().includes(roomId), "the reopened room");

      // No draft edits: the next owner save is projected as usual.
      appendText(owner.workspace().getContent("b"), "Owner after restart");
      owner.doc.commit({ origin: "owner:edit" });
      await waitForSaved(
        state,
        WORKSPACE_ID,
        (workspace) => textOf(workspace, "b").includes("Owner after restart"),
        "the owner save",
      );
      await state.worker.schedule(WORKSPACE_ID, { immediate: true });
      await waitFor(
        () => textOf(editor.workspace(), "b").includes("Owner after restart"),
        "the projection after restart",
      );

      // A real draft edit marks the room dirty and stops owner projections.
      editor.workspace().placeCard(BOARD_ID, "a", { x: 777, y: 888 });
      editor.doc.commit({ origin: "editor:edit" });
      await waitForSaved(
        state,
        roomId,
        (workspace) => workspace.getPlacement(BOARD_ID, "a")?.x === 777,
        "the draft edit",
      );

      appendText(owner.workspace().getContent("b"), "Second owner note");
      owner.doc.commit({ origin: "owner:edit" });
      await waitForSaved(
        state,
        WORKSPACE_ID,
        (workspace) => textOf(workspace, "b").includes("Second owner note"),
        "the second owner save",
      );
      await state.worker.schedule(WORKSPACE_ID, { immediate: true });

      expect(editor.workspace().getPlacement(BOARD_ID, "a")?.x).toBe(777);
      expect(textOf(editor.workspace(), "b")).not.toContain("Second owner note");
    } finally {
      await closeOwnerAndEditor(owner, editor);
    }
  }, 20_000);

  it("waits for the editor's version before publishing the draft", async () => {
    const { state, share, roomId, owner, editor } = await editorHarness();
    try {
      // A second writer holds the unplace but has not joined the room yet. The
      // publish starts first, so only the version gate can save it: without the
      // gate the worker would plan against the stale room and put the card back.
      const next = new LoroDoc();
      next.import(editor.doc.export({ mode: "snapshot" }));
      new WorkspaceDocument(next).unplaceCard(BOARD_ID, "b");
      const version = Object.fromEntries(
        [...next.version().toJSON()].map(([peer, counter]) => [String(peer), counter]),
      );

      const pending = state.worker.publish(share, version);

      const writer = new LoroWebsocketClient({ url: state.url });
      const writerRoom = await writer.join({
        roomId,
        crdtAdaptor: new LoroAdaptor(next),
        auth: () => new TextEncoder().encode(PROJECTION_TOKEN),
      });
      try {
        expect(await pending).toEqual({ ok: true, applied: 1 });
      } finally {
        await writerRoom.leave().catch(() => undefined);
        writer.close();
      }

      await waitFor(
        () => owner.workspace().getPlacement(BOARD_ID, "b") === undefined,
        "the owner to receive the unplace",
      );
      expect(editor.workspace().getPlacement(BOARD_ID, "b")).toBeUndefined();
    } finally {
      await closeOwnerAndEditor(owner, editor);
    }
  }, 20_000);

  it("refuses a publish whose version never reaches the room", async () => {
    const { state, share, owner, editor } = await editorHarness();
    try {
      editor.workspace().unplaceCard(BOARD_ID, "b");
      editor.doc.commit({ origin: "editor:edit" });

      const [peer] = [...editor.doc.version().toJSON().keys()];
      expect(peer).toBeDefined();
      const result = await state.worker.publish(share, { [String(peer)]: 999_999 });

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toContain("syncing");

      // Nothing was written or rebuilt: the owner still has the card placed and
      // the draft keeps its own unplace.
      await delay(100);
      expect(owner.workspace().getPlacement(BOARD_ID, "b")).toBeDefined();
      expect(editor.workspace().getPlacement(BOARD_ID, "b")).toBeUndefined();
    } finally {
      await closeOwnerAndEditor(owner, editor);
    }
  }, 20_000);

  it("refuses to publish when the workspace connection is gone", async () => {
    const { state, share, owner, editor } = await editorHarness();
    try {
      editor.workspace().placeCard(BOARD_ID, "a", { x: 480, y: 580 });
      editor.doc.commit({ origin: "editor:edit" });

      // Dropping the server takes the live writer down; saved bytes may lag, so
      // the publish must fail instead of writing into a stale document.
      await state.server.stop();
      await waitFor(
        () => state.worker.sourceStatus(WORKSPACE_ID) !== "joined",
        "the writer to notice the outage",
      );

      const result = await state.worker.publish(share);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toContain("not available");
    } finally {
      await closeOwnerAndEditor(owner, editor);
    }
  }, 20_000);
});
