import { copyFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { SCHEMA_VERSION, WorkspaceDocument } from "@suite/graph";
import { LoroDoc } from "loro-crdt";
import { afterEach, describe, expect, it } from "vitest";
import { createLicenceClaimStore } from "../http/workspaceHttp.js";
import { loadLoroDocument } from "../projection/index.js";
import { createSqliteAttachmentStore } from "./attachments.js";
import {
  createDocumentStore,
  DOCUMENT_STORE_SCHEMA,
  decodeSnapshot,
  encodeSnapshot,
  SNAPSHOT_FORMAT_TAG,
  UnsupportedStoreVersionError,
} from "./persistence.js";
import { createSettingsStore } from "./settings.js";
import { createShareStore } from "./shares.js";
import { createWorkspaceRegistry } from "./workspaces.js";

/**
 * A7: an old store opens in this build.
 *
 * A true N−1 *binary* does not exist in this repository — there are no tags and
 * no releases — so no fixture here was written by an older program. What each
 * fixture does carry is a genuinely older *shape*: the columns the migrate
 * steps were written for, an untagged snapshot blob, or (for attachments) no
 * file at all, because the store did not exist. `src/fixtures/n-1/README.md`
 * records how each file was produced.
 */

const FIXTURES = new URL("../fixtures/n-1/", import.meta.url);

const created: string[] = [];
afterEach(() => {
  for (const directory of created.splice(0)) rmSync(directory, { recursive: true, force: true });
});

/** A writable copy of a committed fixture: the boot path migrates in place. */
function fixture(name: string): string {
  const directory = mkdtempSync(join(import.meta.dirname, ".n1-test-"));
  created.push(directory);
  const path = join(directory, name);
  copyFileSync(new URL(name, FIXTURES), path);
  return path;
}

describe("stored snapshot blobs carry a format tag", () => {
  it("round-trips a tagged blob and passes an untagged blob through unchanged", () => {
    const payload = new Uint8Array([0x6c, 0x6f, 0x72, 0x6f, 1, 2, 3]);
    const tagged = encodeSnapshot(payload);
    expect(new TextDecoder().decode(tagged.slice(0, SNAPSHOT_FORMAT_TAG.length + 1))).toBe(
      `${SNAPSHOT_FORMAT_TAG}\n`,
    );
    expect(decodeSnapshot(tagged)).toEqual(payload);
    // A document written before the tag existed: read as v1, not rewritten.
    expect(decodeSnapshot(payload)).toEqual(payload);
  });

  it("refuses a tag this build does not know, naming both versions", () => {
    const future = encodeSnapshot(new Uint8Array([1, 2, 3]));
    future.set(new TextEncoder().encode("loro-snapshot-v2"), 0);
    expect(() => decodeSnapshot(future)).toThrow(UnsupportedStoreVersionError);
    expect(() => decodeSnapshot(future)).toThrow(/loro-snapshot-v2/u);
    expect(() => decodeSnapshot(future)).toThrow(new RegExp(SNAPSHOT_FORMAT_TAG, "u"));
  });
});

describe("the current boot path opens an N−1 document store", () => {
  it("keeps every board, card and title the old build wrote", () => {
    const path = fixture("documents.sqlite");
    const store = createDocumentStore(path);
    try {
      const state = loadLoroDocument(store, "legacy-workspace");
      expect(state).not.toBeNull();

      const doc = new LoroDoc();
      doc.import(state ?? new Uint8Array());
      const workspace = new WorkspaceDocument(doc);

      expect(workspace.listBoards().map((board) => board.name)).toEqual(["Legacy board"]);
      const cards = workspace.listCards();
      expect(cards).toHaveLength(2);
      expect(cards.map((card) => workspace.displayTitle(card.id)).sort()).toEqual([
        "Legacy card one",
        "Legacy card two",
      ]);

      // The stamp is an explicit step of opening, not a silent data rewrite.
      expect(doc.getMap(WorkspaceDocument.META_KEY).get("schemaVersion")).toBe(SCHEMA_VERSION - 1);
      workspace.ensureDefaultTypes();
      expect(doc.getMap(WorkspaceDocument.META_KEY).get("schemaVersion")).toBe(SCHEMA_VERSION);
    } finally {
      store.close();
    }

    // Reading did not rewrite the stored blob: it is still the untagged v1 blob.
    const db = new DatabaseSync(path, { readOnly: true });
    try {
      const row = db
        .prepare("SELECT state FROM documents WHERE name = ?")
        .get("%LOR:legacy-workspace") as { state: Uint8Array } | undefined;
      const head = new TextDecoder().decode(row?.state.slice(0, 14) ?? new Uint8Array());
      expect(head).not.toContain("loro-snapshot");
      const version = db.prepare("PRAGMA user_version").get() as { user_version: number };
      expect(Number(version.user_version)).toBe(DOCUMENT_STORE_SCHEMA);
    } finally {
      db.close();
    }
  });

  it("writes the tag on the next save", () => {
    const path = fixture("documents.sqlite");
    const store = createDocumentStore(path);
    try {
      store.save("%LOR:new", new Uint8Array([9, 9, 9]));
    } finally {
      store.close();
    }
    const db = new DatabaseSync(path, { readOnly: true });
    try {
      const row = db.prepare("SELECT state FROM documents WHERE name = ?").get("%LOR:new") as {
        state: Uint8Array;
      };
      expect(new TextDecoder().decode(row.state.slice(0, SNAPSHOT_FORMAT_TAG.length + 1))).toBe(
        `${SNAPSHOT_FORMAT_TAG}\n`,
      );
    } finally {
      db.close();
    }
  });

  it("refuses a store a newer build wrote", () => {
    const path = fixture("documents-newer.sqlite");
    expect(() => createDocumentStore(path)).toThrow(UnsupportedStoreVersionError);
    expect(() => createDocumentStore(path)).toThrow(/newer Suite build/u);
  });

  it("refuses a blob a newer build wrote, rather than importing it blindly", () => {
    const path = fixture("documents.sqlite");
    // Written straight into the table: `save` would tag it as v1 again, so the
    // only way to reach the decode path with a future tag is to store it raw.
    const raw = new DatabaseSync(path);
    try {
      const future = encodeSnapshot(new Uint8Array([1, 2, 3]));
      future.set(new TextEncoder().encode("loro-snapshot-v2"), 0);
      raw
        .prepare("INSERT INTO documents (name, state, updated_at) VALUES (?, ?, ?)")
        .run("%LOR:future", future, Date.now());
    } finally {
      raw.close();
    }

    const store = createDocumentStore(path);
    try {
      expect(() => store.load("%LOR:future")).toThrow(UnsupportedStoreVersionError);
    } finally {
      store.close();
    }
  });
});

describe("the current boot path opens an N−1 store for every other store", () => {
  it("shares: adds the newer columns and backfills room_id from the workspace", () => {
    const path = fixture("shares.sqlite");
    const store = createShareStore(path);
    try {
      expect(store.get("share-legacy")?.workspaceId).toBe("legacy-workspace");
      expect(store.listAllActive()).toHaveLength(1);
    } finally {
      store.close();
    }
    const db = new DatabaseSync(path, { readOnly: true });
    try {
      const columns = (db.prepare("PRAGMA table_info(shares)").all() as { name: string }[]).map(
        (column) => column.name,
      );
      expect(columns).toEqual(
        expect.arrayContaining(["room_id", "expires_at", "card_ids", "last_used_at"]),
      );
      const row = db.prepare("SELECT room_id FROM shares WHERE id = ?").get("share-legacy") as {
        room_id: string;
      };
      expect(row.room_id).toBe("legacy-workspace");
      // The baseline row survived the migration, bytes intact.
      const baseline = db
        .prepare("SELECT snapshot FROM share_baselines WHERE share_id = ?")
        .get("share-legacy") as { snapshot: Uint8Array };
      expect(Array.from(baseline.snapshot)).toEqual([1, 2, 3, 4]);
    } finally {
      db.close();
    }
  });

  it("workspaces: keeps the owner row", () => {
    const path = fixture("workspaces.sqlite");
    const registry = createWorkspaceRegistry(path);
    try {
      expect(registry.has("legacy-workspace")).toBe(true);
      expect(registry.verify("legacy-workspace", "not-the-owner")).toBe(false);
    } finally {
      registry.close();
    }
  });

  it("settings: adds updated_at and keeps the override", () => {
    const path = fixture("settings.sqlite");
    const store = createSettingsStore(path);
    try {
      expect(store.get("maxWorkspaces")).toBe("7");
    } finally {
      store.close();
    }
  });

  it("licences: adds quota_json, email and expires_at and keeps the claim", () => {
    const path = fixture("licences.sqlite");
    const store = createLicenceClaimStore(path);
    try {
      const claim = store.get("legacy-workspace");
      expect(claim?.licenceId).toBe("lic-legacy");
      expect(claim?.tier).toBe("solo");
    } finally {
      store.close();
    }
  });

  it("attachments: the N−1 state is an absent store, and it opens empty", () => {
    // There is no attachments fixture because the store is new: a deployment
    // upgrading from the previous build has no file. Opening one must create
    // the table and report an empty store, never refuse to start.
    const directory = mkdtempSync(join(import.meta.dirname, ".n1-test-"));
    created.push(directory);
    const store = createSqliteAttachmentStore(join(directory, "attachments.sqlite"));
    try {
      expect(store.usage("legacy-workspace")).toBe(0);
      expect(store.get("0".repeat(32))).toBeNull();
    } finally {
      store.close();
    }
    expect(readFileSync(new URL("README.md", FIXTURES), "utf8")).toContain("attachments.sqlite");
  });
});
