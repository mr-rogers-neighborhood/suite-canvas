import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { WorkspaceDocument } from "@suite/graph";
import { LoroAdaptor } from "loro-adaptors/loro";
import { LoroDoc, LoroMap, LoroText } from "loro-crdt";
import { LoroWebsocketClient } from "loro-websocket";
import { SimpleServer } from "loro-websocket/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DocumentStore } from "./persistence.js";
import {
  loadLoroDocument,
  loroDocumentKey,
  loroDocumentKeys,
  ProjectionWorker,
} from "./projectionWorker.js";
import { createShareStore, type ShareStore } from "./shares.js";

const INTERNAL_TOKEN = "test-internal-token";
const WORKSPACE_ID = "ws-1";
const BOARD_ID = "board-1";

interface Harness {
  server: SimpleServer;
  url: string;
  documents: DocumentStore;
  shares: ShareStore;
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

async function startHarness(options: { seed?: boolean } = {}): Promise<Harness> {
  const port = await freePort();
  const documents = memoryDocuments();
  const shares = createShareStore(join(directory, "shares.sqlite"));
  const source = seedSource();
  const warnings: string[] = [];

  const server = new SimpleServer({
    port,
    saveInterval: 50,
    onLoadDocument: async (roomId, crdtType) => documents.load(`${crdtType}:${roomId}`),
    async onSaveDocument(roomId, crdtType, data) {
      documents.save(`${crdtType}:${roomId}`, data);
    },
    authenticate: async (roomId, _crdtType, auth) => {
      const token = Buffer.from(auth).toString("utf8");
      if (token === INTERNAL_TOKEN) return "write";
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
    source,
    worker: new ProjectionWorker({
      url: `ws://127.0.0.1:${port}`,
      internalToken: INTERNAL_TOKEN,
      documents,
      shares,
      debounceMs: 60,
      logger: { warn: (text: string) => warnings.push(text) },
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
      await state.worker.start();
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
      viewer.client.destroy();
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
        await state.worker.start();
        await waitFor(() => boardCards(viewer).length === 2, "the legacy workspace");
        expect(boardCards(viewer)).toEqual(["a", "b"]);
      } finally {
        await viewer.room.leave().catch(() => undefined);
        viewer.client.destroy();
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
      await state.worker.start();
      await waitFor(() => viewer.workspace().getCard("a") !== undefined, "the card projection");

      const projected = viewer.workspace();
      expect(projected.listCards().map((card) => card.id)).toEqual(["a"]);
      expect(projected.displayTitle("a")).toBe("Alpha");
      expect(projected.getBoard(BOARD_ID)).toBeUndefined();
    } finally {
      await viewer.room.leave().catch(() => undefined);
      viewer.client.destroy();
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
      await state.worker.start();
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
      viewer.client.destroy();
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
      await state.worker.start();
      await waitFor(() => viewer.workspace().getCard("a") !== undefined, "the card projection");

      state.source.trashCard("a");
      saveSource(state);
      await state.worker.schedule(WORKSPACE_ID, { immediate: true });

      expect(viewer.workspace().getCard("a")).toBeDefined();
      expect(state.warnings.some((text) => text.includes("skipped"))).toBe(true);
      await waitFor(() => state.worker.roomIds().length === 1, "the room to stay open");
    } finally {
      await viewer.room.leave().catch(() => undefined);
      viewer.client.destroy();
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

    await state.worker.start();
    expect(state.worker.roomIds()).toEqual([share.roomId]);

    state.shares.revoke(share.id);
    await state.worker.schedule(WORKSPACE_ID, { immediate: true });

    expect(state.worker.roomIds()).toEqual([]);
  });

  it("ignores workspace shares and a missing document store", async () => {
    const state = await startHarness({ seed: false });
    state.shares.create({ workspaceId: WORKSPACE_ID, scope: "workspace", role: "editor" });

    await state.worker.start();

    expect(state.worker.roomIds()).toEqual([]);
    await expect(state.worker.schedule(WORKSPACE_ID, { immediate: true })).resolves.toBeUndefined();
  });
});
