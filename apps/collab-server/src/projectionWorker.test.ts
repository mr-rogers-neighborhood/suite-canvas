import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { applyProjection, projectWorkspace, WorkspaceDocument } from "@suite/graph";
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
    // Mirrors the production server: one normalized key for loads and saves.
    onLoadDocument: async (roomId) => loadLoroDocument(documents, roomId),
    async onSaveDocument(roomId, _crdtType, data) {
      documents.save(loroDocumentKey(roomId), data);
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

function createWorker(
  state: Pick<Harness, "url" | "documents" | "shares" | "warnings">,
): ProjectionWorker {
  return new ProjectionWorker({
    url: state.url,
    internalToken: INTERNAL_TOKEN,
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
    const owner = await openViewer(state.url, WORKSPACE_ID, INTERNAL_TOKEN);
    const editor = await openEditor(state, roomId, token);
    await state.worker.start();
    await waitFor(() => boardCards(editor).length === 2, "the editor projection");
    await waitFor(() => owner.workspace().getCard("a") !== undefined, "the owner copy");
    return { state, token, share, roomId, owner, editor, fieldId };
  }

  async function closeOwnerAndEditor(owner: Viewer, editor: Viewer): Promise<void> {
    for (const viewer of [owner, editor]) {
      await viewer.room.leave().catch(() => undefined);
      try {
        viewer.client.destroy();
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
      appendText(owner.workspace().getContent("a"), "Owner text");
      owner.doc.commit({ origin: "owner:edit" });
      await waitForSaved(
        state,
        WORKSPACE_ID,
        (workspace) => textOf(workspace, "a").includes("Owner text"),
        "the owner write on the server",
      );

      appendText(editor.workspace().getContent("a"), "Editor text");
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
      expect(result.conflicts.map((conflict) => conflict.key)).toContain("card:a:body");
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
      await state.worker.start();
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
    const { state, roomId, owner, editor } = await editorHarness();
    try {
      await state.worker.stop();

      // Someone rewrites the room with the same projection: every value matches
      // the baseline, but the room version advances past it.
      const historyBefore = savedVersion(state.documents, roomId);
      const rewriter = await openViewer(state.url, roomId, INTERNAL_TOKEN);
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
        rewriter.client.destroy();
      }

      state.worker = createWorker(state);
      await state.worker.start();
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
        auth: () => new TextEncoder().encode(INTERNAL_TOKEN),
      });
      try {
        expect(await pending).toEqual({ ok: true, applied: 1 });
      } finally {
        await writerRoom.leave().catch(() => undefined);
        writer.destroy();
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
