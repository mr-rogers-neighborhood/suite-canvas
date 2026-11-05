import { mkdir, mkdtemp, readdir, readFile, rm, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildWorkspaceFile,
  createWorkspaceFile,
  LEGACY_WORKSPACE_FILE_KIND,
  readWorkspaceFile,
  WORKSPACE_FILE_KIND,
  WorkspaceDocument,
} from "@suite/graph";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { SaveDocumentRequest } from "../shared/ipc.js";
import { desktopPaths } from "./paths.js";
import { DocumentStore } from "./store.js";

let root = "";
let library = "";
let data = "";
let paths = desktopPaths("linux", "/home/me");

function sampleWorkspace(cards = 1): WorkspaceDocument {
  const workspace = new WorkspaceDocument();
  workspace.ensureDefaultTypes();
  const board = workspace.ensureBoard();
  workspace.renameBoard(board.id, "Research");
  for (let index = 0; index < cards; index += 1) {
    workspace.createCard({
      id: `c${index}`,
      boardId: board.id,
      position: { x: index * 10, y: 0 },
    });
  }
  return workspace;
}

function envelopeJson(workspace: WorkspaceDocument, workspaceId = "ws-1"): string {
  return createWorkspaceFile(workspaceId, workspace, "2026-11-04T20:00:00.000Z").json;
}

function saveRequest(
  workspace: WorkspaceDocument,
  overrides: Partial<SaveDocumentRequest> = {},
): SaveDocumentRequest {
  return {
    workspaceId: "ws-1",
    snapshot: new Uint8Array(workspace.exportSnapshot()),
    manifest: {
      boards: workspace.listBoards().length,
      cards: workspace.listCards().length,
      types: workspace.listTypes().length,
      tags: workspace.listTags().length,
    },
    ...overrides,
  };
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "suite-desktop-"));
  library = join(root, "Documents", "Suite", "Canvas");
  data = join(root, "data");
  await mkdir(library, { recursive: true });
  paths = { library, data, locks: join(data, "locks") };
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("DocumentStore.open", () => {
  it("opens a .canvas file and hands the renderer a snapshot", async () => {
    const path = join(library, "Research.canvas");
    await writeFile(path, envelopeJson(sampleWorkspace(2)));

    const result = await DocumentStore.open(path, { paths });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.info.workspaceId).toBe("ws-1");
    expect(result.info.name).toBe("Research.canvas");
    expect(result.info.migratedFrom).toBeNull();
    // The snapshot is binary, so it is read back through the format rather than
    // by parsing it as JSON.
    const restored = readWorkspaceFile(
      JSON.stringify(
        buildWorkspaceFile({
          workspaceId: result.info.workspaceId,
          snapshot: result.snapshot,
          manifest: { boards: 1, cards: 2, types: 0, tags: 0 },
        }),
      ),
    );
    expect(restored.workspace.listCards()).toHaveLength(2);
    await result.store.close();
  });

  it("refuses a second open of the same file and names the holder", async () => {
    const path = join(library, "Research.canvas");
    await writeFile(path, envelopeJson(sampleWorkspace()));

    const first = await DocumentStore.open(path, { paths });
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const second = await DocumentStore.open(path, { paths });
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.code).toBe("locked");
    expect(second.message).toContain("Research.canvas");

    await first.store.close();
    // And once released, it opens.
    const third = await DocumentStore.open(path, { paths });
    expect(third.ok).toBe(true);
    if (third.ok) await third.store.close();
  });

  it("converts a legacy .suite canvas file and keeps the original", async () => {
    const legacyPath = join(library, "Old.suite");
    const legacy = JSON.parse(envelopeJson(sampleWorkspace())) as Record<string, unknown>;
    await writeFile(
      legacyPath,
      JSON.stringify({ ...legacy, kind: LEGACY_WORKSPACE_FILE_KIND, version: 2 }),
    );

    const result = await DocumentStore.open(legacyPath, { paths });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.info.migratedFrom).toBe("Old.suite");
    expect(result.info.path).toBe(join(library, "Old.canvas"));

    const names = await readdir(library);
    expect(names).toContain("Old.suite");
    expect(names).toContain("Old.canvas");

    // The new file is the current envelope, and the snapshot survived.
    const converted = readWorkspaceFile(await readFile(join(library, "Old.canvas"), "utf8"));
    expect(converted.file.kind).toBe(WORKSPACE_FILE_KIND);
    expect(converted.workspace.listCards()).toHaveLength(1);
    await result.store.close();
  });

  it("never replaces a damaged file with an empty one", async () => {
    const path = join(library, "Broken.canvas");
    await writeFile(path, "{ this is not a document");

    const result = await DocumentStore.open(path, { paths });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("corrupt");

    // The bytes are exactly as they were, and the lock was released.
    expect(await readFile(path, "utf8")).toBe("{ this is not a document");
    expect(await readdir(paths.locks).catch(() => [])).toEqual([]);
  });

  it("recovers from a backup when the file is damaged, without touching the file", async () => {
    const path = join(library, "Research.canvas");
    const good = envelopeJson(sampleWorkspace(3));
    await writeFile(path, good);
    await writeFile(`${path}.2026-11-03T08-00-00-000Z.bak`, good);
    await truncate(path, 40);

    const result = await DocumentStore.open(path, { paths });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.info.recoveredFrom).toBe("Research.canvas.2026-11-03T08-00-00-000Z.bak");
    // The damaged file is left alone: it is the only copy of whatever happened.
    expect((await readFile(path, "utf8")).length).toBe(40);
    await result.store.close();
  });

  it("reports a real refusal for a file that is not a document", async () => {
    const path = join(library, "notes.canvas");
    await writeFile(path, JSON.stringify({ kind: "something.else" }));
    const result = await DocumentStore.open(path, { paths });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("corrupt");
  });
});

describe("DocumentStore.save", () => {
  async function opened(cards = 1) {
    const path = join(library, "Research.canvas");
    const workspace = sampleWorkspace(cards);
    await writeFile(path, envelopeJson(workspace));
    const result = await DocumentStore.open(path, { paths, debounceMs: 5 });
    if (!result.ok) throw new Error(result.message);
    return { path, workspace, store: result.store };
  }

  it("writes a save through to the file, keeping the envelope current", async () => {
    const { path, store, workspace } = await opened();
    workspace.createCard({
      id: "extra",
      boardId: workspace.listBoards()[0]?.id ?? "b",
      position: { x: 0, y: 0 },
    });

    store.save(saveRequest(workspace));
    await store.flush();

    const written = readWorkspaceFile(await readFile(path, "utf8"));
    expect(written.file.kind).toBe(WORKSPACE_FILE_KIND);
    expect(written.workspace.listCards().map((card) => card.id)).toContain("extra");
    await store.close();
  });

  it("carries an attachment into the file, and keeps it across a document-only save", async () => {
    const { path, store, workspace } = await opened();
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);

    store.save(
      saveRequest(workspace, {
        attachments: [
          {
            id: "0123456789abcdef0123456789abcdef",
            mime: "image/png",
            name: "pixel.png",
            width: 1,
            height: 1,
            bytes,
          },
        ],
      }),
    );
    await store.flush();

    // A later save with no attachment section must not drop the image.
    store.save(saveRequest(workspace));
    await store.flush();

    const written = readWorkspaceFile(await readFile(path, "utf8"));
    expect(written.attachments).toHaveLength(1);
    expect(Array.from(written.attachments[0]?.bytes ?? [])).toEqual(Array.from(bytes));
    await store.close();
  });

  it("stops writing when the file changed on disk, rather than overwriting it", async () => {
    const { path, store, workspace } = await opened();
    store.save(saveRequest(workspace));
    await store.flush();

    // Something outside the app rewrote the file.
    const outside = envelopeJson(sampleWorkspace(9), "ws-outside");
    await writeFile(path, outside);

    store.save(saveRequest(workspace));
    await store.flush();

    expect(store.lastFailure?.code).toBe("changed-on-disk");
    expect(readWorkspaceFile(await readFile(path, "utf8")).file.workspaceId).toBe("ws-outside");
    await store.close();
  });

  it("refuses a request that is not a document rather than writing it", async () => {
    const { store } = await opened();
    store.save({
      workspaceId: "",
      snapshot: new Uint8Array(),
      manifest: { boards: -1 },
    } as unknown as SaveDocumentRequest);
    await store.flush();
    expect(store.lastFailure?.code).toBe("not-a-document");
    await store.close();
  });

  it("keeps a backup from when the session opened, and one per day", async () => {
    let now = Date.parse("2026-11-04T09:00:00.000Z");
    const path = join(library, "Research.canvas");
    const workspace = sampleWorkspace();
    await writeFile(path, envelopeJson(workspace));

    const opened = await DocumentStore.open(path, { paths, debounceMs: 1, now: () => now });
    if (!opened.ok) throw new Error(opened.message);

    const afterOpen = await readdir(library);
    expect(
      afterOpen.some((name) => name.startsWith("Research.canvas.") && name.endsWith(".bak")),
    ).toBe(true);

    opened.store.save(saveRequest(workspace));
    await opened.store.flush();
    const sameDay = (await readdir(library)).filter((name) => name.endsWith(".bak"));
    expect(sameDay).toHaveLength(1);

    // A later day adds one more backup rather than a second for the same day.
    now = Date.parse("2026-11-05T09:00:00.000Z");
    opened.store.save(saveRequest(workspace));
    await opened.store.flush();
    expect((await readdir(library)).filter((name) => name.endsWith(".bak"))).toHaveLength(2);
    await opened.store.close();
  });
});
