import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createWorkspaceRegistry, hashOwnerKey, type WorkspaceRegistry } from "./workspaces.js";

let directory: string;
let registry: WorkspaceRegistry;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "suite-workspaces-"));
  registry = createWorkspaceRegistry(join(directory, "workspaces.sqlite"));
});

afterEach(() => {
  registry.close();
  rmSync(directory, { recursive: true, force: true });
});

describe("workspace registry", () => {
  it("claims a workspace on first use and verifies the same key", () => {
    expect(registry.has("ws-1")).toBe(false);
    expect(registry.claimOrVerify("ws-1", "owner-key-1")).toBe("owner");
    expect(registry.has("ws-1")).toBe(true);
    expect(registry.verify("ws-1", "owner-key-1")).toBe(true);
    expect(registry.verify("ws-1", "owner-key-2")).toBe(false);
  });

  it("keeps the first claim and reports an idempotent match", () => {
    expect(registry.claimOrVerify("ws-1", "owner-key-1")).toBe("owner");
    expect(registry.claimOrVerify("ws-1", "owner-key-1")).toBe("owner");
    expect(registry.claimOrVerify("ws-1", "owner-key-2")).toBe("mismatch");
    // A mismatch must not steal the workspace.
    expect(registry.verify("ws-1", "owner-key-1")).toBe(true);
  });

  it("stores only the SHA-256 hash of the key", () => {
    const path = join(directory, "workspaces.sqlite");
    registry.claimOrVerify("ws-1", "owner-key-1");

    const db = new DatabaseSync(path);
    try {
      const row = db
        .prepare("SELECT owner_hash, created_at, claimed_at FROM workspaces WHERE workspace_id = ?")
        .get("ws-1") as { owner_hash: string; created_at: number; claimed_at: number } | undefined;
      expect(row?.owner_hash).toBe(hashOwnerKey("owner-key-1"));
      expect(row?.owner_hash).not.toBe("owner-key-1");
      expect(row?.owner_hash).toHaveLength(64);
      expect(row?.created_at).toBeGreaterThan(0);
      expect(row?.claimed_at).toBeGreaterThan(0);
    } finally {
      db.close();
    }
  });

  it("keeps the claim after the registry reopens", () => {
    const path = join(directory, "workspaces.sqlite");
    registry.claimOrVerify("ws-1", "owner-key-1");
    registry.close();

    registry = createWorkspaceRegistry(path);
    expect(registry.claimOrVerify("ws-1", "owner-key-1")).toBe("owner");
    expect(registry.claimOrVerify("ws-1", "owner-key-2")).toBe("mismatch");
  });

  it("rejects empty or oversized inputs", () => {
    expect(() => registry.claimOrVerify("", "owner-key-1")).toThrow("workspace id");
    expect(() => registry.claimOrVerify("  ", "owner-key-1")).toThrow("workspace id");
    expect(() => registry.claimOrVerify("ws-1", "")).toThrow("owner key");
    expect(() => registry.claimOrVerify("ws-1", "   ")).toThrow("owner key");
    expect(() => registry.claimOrVerify("w".repeat(513), "owner-key-1")).toThrow("workspace id");
    expect(() => registry.claimOrVerify("ws-1", "k".repeat(513))).toThrow("owner key");
    expect(() => registry.verify("ws-1", "")).toThrow("owner key");
    expect(registry.has("")).toBe(false);
    expect(registry.has("unknown")).toBe(false);
  });
});
