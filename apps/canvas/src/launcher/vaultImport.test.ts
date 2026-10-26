import { WorkspaceDocument } from "@suite/graph";
import type { DroppedEntryLike } from "@suite/import-obsidian";
import { LoroDoc } from "loro-crdt";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { importVaultIntoWorkspace, lossDetail, vaultName } from "./vaultImport";

/**
 * The launcher's Obsidian drop.
 *
 * What has to be true: the vault lands in the workspace whose row it was
 * dropped on — never in a new one — and every class of loss the report carries
 * reaches the person who dropped it.
 */

/** Stands in for the browser's IndexedDB copy of a workspace. */
const stored = vi.hoisted(() => ({
  snapshot: null as Uint8Array | null,
  written: null as unknown,
}));

vi.mock("../collab/loroPersistence", () => ({
  LoroIndexeddbPersistence: class {
    constructor(
      readonly workspaceId: string,
      private readonly doc: LoroDoc,
    ) {}

    async load(): Promise<void> {
      if (stored.snapshot) this.doc.import(stored.snapshot);
    }

    async compact(): Promise<void> {
      stored.written = this.doc.export({ mode: "snapshot" });
    }

    destroy(): void {}
  },
}));

/** A note or canvas, as a drop hands it over. */
function file(name: string, text: string): DroppedEntryLike {
  return {
    isFile: true,
    isDirectory: false,
    name,
    file: (onFile) => onFile({ name, size: text.length, text: async () => text }),
  };
}

function folder(name: string, children: DroppedEntryLike[]): DroppedEntryLike {
  let read = false;
  return {
    isFile: false,
    isDirectory: true,
    name,
    createReader: () => ({
      readEntries: (onEntries) => {
        onEntries(read ? [] : children);
        read = true;
      },
    }),
  };
}

/** A workspace that already exists on this device: a board, a card, a name. */
function seedWorkspace(): void {
  const doc = new LoroDoc();
  const workspace = new WorkspaceDocument(doc);
  workspace.ensureDefaultTypes();
  const board = workspace.ensureBoard();
  workspace.renameBoard(board.id, "Existing");
  workspace.createCard({ id: "kept", boardId: board.id, position: { x: 0, y: 0 } });
  workspace.setTitleText("kept", "Already here");
  stored.snapshot = doc.export({ mode: "snapshot" });
}

function importedCards(): string[] {
  const bytes = stored.written as Uint8Array | null;
  if (!bytes) return [];
  const doc = new LoroDoc();
  doc.import(bytes);
  return new WorkspaceDocument(doc).listCards().map((card) => card.id);
}

beforeEach(() => {
  stored.snapshot = null;
  stored.written = null;
});

describe("importVaultIntoWorkspace", () => {
  it("writes the vault into the workspace it was dropped on, keeping its cards", async () => {
    seedWorkspace();
    const outcome = await importVaultIntoWorkspace({
      workspaceId: "ws-1",
      entries: [folder("Vault", [file("Ideas.md", "# Ideas\n\nA thought.")])],
      homeBoardName: "Vault",
    });

    expect(outcome.ok).toBe(true);
    expect(outcome.message).toContain("card");
    expect(outcome.boardId).toBeTruthy();
    // The existing card is still there: the import merged into that document.
    expect(importedCards()).toContain("kept");
    expect(stored.written).not.toBeNull();
  });

  it("refuses a workspace this device does not hold, instead of making one", async () => {
    const outcome = await importVaultIntoWorkspace({
      workspaceId: "ws-missing",
      entries: [folder("Vault", [file("Ideas.md", "# Ideas")])],
    });

    expect(outcome.ok).toBe(false);
    expect(outcome.message).toContain("not stored on this device");
    // Nothing was written: a refusal that still wrote would be a new workspace.
    expect(stored.written).toBeNull();
  });

  it("refuses a drop that holds nothing it can read, and says so", async () => {
    seedWorkspace();
    const outcome = await importVaultIntoWorkspace({
      workspaceId: "ws-1",
      entries: [folder("Vault", [])],
    });

    expect(outcome.ok).toBe(false);
    expect(outcome.message).toContain("no notes or canvases");
    expect(stored.written).toBeNull();
  });

  it("names every class of loss a partial import leaves behind", async () => {
    seedWorkspace();
    const outcome = await importVaultIntoWorkspace({
      workspaceId: "ws-1",
      entries: [
        folder("Vault", [
          file(
            "Ideas.md",
            "---\nowner: Ada\n---\n# Ideas\n\nSee [[Nowhere]] and ![[diagram.png]]\n",
          ),
          file("diagram.png", ""),
          file(".obsidian/app.json", "{}"),
        ]),
      ],
    });

    expect(outcome.ok).toBe(true);
    const detail = outcome.detail ?? "";
    // A link to a note the vault never had.
    expect(detail).toMatch(/link\(s\) point at notes/);
    // A frontmatter key with no field to fill.
    expect(detail).toMatch(/stay as text/);
    // An embedded file whose bytes are not imported.
    expect(detail).toMatch(/embedded file\(s\) were not imported/);
    // A file the import did not read, named with its reason.
    expect(detail).toMatch(/file\(s\) were not read/);
  });

  it("summarises a clean import without inventing a loss", async () => {
    seedWorkspace();
    const outcome = await importVaultIntoWorkspace({
      workspaceId: "ws-1",
      entries: [folder("Vault", [file("Ideas.md", "# Ideas\n\nA thought.")])],
    });

    expect(outcome.ok).toBe(true);
    expect(outcome.detail ?? "").not.toMatch(/not read|not imported|unresolved/);
  });
});

describe("vaultName", () => {
  it("names the drop after the folder, not the files inside it", () => {
    expect(vaultName([folder("Research", [file("a.md", "")])])).toBe("Research");
    expect(vaultName([file("loose.md", "")])).toBeUndefined();
  });
});

describe("lossDetail", () => {
  it("is undefined when the report has nothing to report", () => {
    const workspace = new WorkspaceDocument();
    workspace.ensureDefaultTypes();
    workspace.ensureBoard();
    expect(
      lossDetail(
        {
          files: { total: 1, notes: 1, canvases: 0, attachments: 0, skipped: 0 },
          records: { boards: 1, cards: 1, sections: 0, tags: 0, links: 0 },
          links: { resolved: 1, unresolved: [], ambiguous: [] },
          properties: { mapped: 0, keptAsText: [] },
          colours: { sections: 0, cards: 0, unmapped: [] },
          attachments: [],
          skipped: [],
          notes: [],
          boards: [],
        },
        [],
      ),
    ).toBeUndefined();
  });
});
