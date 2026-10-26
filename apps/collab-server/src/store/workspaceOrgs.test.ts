import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createWorkspaceOrgStore, type WorkspaceOrgStore } from "./workspaceOrgs.js";

let directory: string;
let path: string;
let store: WorkspaceOrgStore;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "suite-workspace-orgs-"));
  path = join(directory, "workspaces.sqlite");
  store = createWorkspaceOrgStore(path);
});

afterEach(() => {
  store.close();
  rmSync(directory, { recursive: true, force: true });
});

describe("workspace organizations", () => {
  it("records the organization a verified session proved", () => {
    expect(store.has("ws-1")).toBe(false);
    expect(store.claim("ws-1", "org-a")).toBe("claimed");
    expect(store.has("ws-1")).toBe(true);
    expect(store.get("ws-1")?.organizationId).toBe("org-a");
  });

  it("keeps the first claim and reports the same organization as owned", () => {
    expect(store.claim("ws-1", "org-a")).toBe("claimed");
    expect(store.claim("ws-1", "org-a")).toBe("owned");
    expect(store.claim("ws-1", "org-b")).toBe("conflict");
    // A conflict must not steal the workspace.
    expect(store.get("ws-1")?.organizationId).toBe("org-a");
  });

  it("stores the organization id and nothing that could act as a credential", () => {
    store.claim("ws-1", "org-a", 1_700_000_000_000);

    const db = new DatabaseSync(path);
    try {
      const columns = db.prepare("PRAGMA table_info(workspace_orgs)").all() as { name?: string }[];
      expect(columns.map((column) => column.name)).toEqual([
        "workspace_id",
        "organization_id",
        "opened_at",
      ]);
      const row = db
        .prepare("SELECT organization_id, opened_at FROM workspace_orgs WHERE workspace_id = ?")
        .get("ws-1") as { organization_id: string; opened_at: number } | undefined;
      expect(row?.organization_id).toBe("org-a");
      expect(row?.opened_at).toBe(1_700_000_000_000);
    } finally {
      db.close();
    }
  });

  it("keeps the row after the store reopens", () => {
    store.claim("ws-1", "org-a");
    store.close();

    store = createWorkspaceOrgStore(path);
    expect(store.get("ws-1")?.organizationId).toBe("org-a");
    expect(store.claim("ws-1", "org-b")).toBe("conflict");
  });

  it("drops a workspace row on delete", () => {
    store.claim("ws-1", "org-a");
    expect(store.remove("ws-1")).toBe(1);
    expect(store.has("ws-1")).toBe(false);
    expect(store.remove("ws-1")).toBe(0);
  });

  it("rejects empty or oversized inputs", () => {
    expect(() => store.claim("", "org-a")).toThrow("workspace id");
    expect(() => store.claim("  ", "org-a")).toThrow("workspace id");
    expect(() => store.claim("ws-1", "")).toThrow("organization id");
    expect(() => store.claim("ws-1", "   ")).toThrow("organization id");
    expect(() => store.claim("w".repeat(513), "org-a")).toThrow("workspace id");
    expect(() => store.claim("ws-1", "o".repeat(513))).toThrow("organization id");
    expect(store.has("")).toBe(false);
    expect(store.get("unknown")).toBeNull();
  });

  it("stamps the schema version and refuses a file from a newer build", () => {
    store.close();
    const db = new DatabaseSync(path);
    db.exec("PRAGMA user_version = 99");
    db.close();

    expect(() => createWorkspaceOrgStore(path)).toThrow(/newer Suite build/u);
    store = createWorkspaceOrgStore(join(directory, "unused.sqlite"));
  });
});
