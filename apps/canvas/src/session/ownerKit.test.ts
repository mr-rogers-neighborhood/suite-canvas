import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  assertOwnerKitWorkspace,
  clearSavedRecoveryKey,
  createOwnerKit,
  downloadOwnerKit,
  hasSavedRecoveryKey,
  OWNER_KIT_KIND,
  ownerKitFilename,
  parseOwnerKit,
} from "./ownerKit";

const WORKSPACE = "ws-1";
const KEY = "owner-key-1";

describe("createOwnerKit", () => {
  it("writes a readable JSON envelope with no document", () => {
    const text = createOwnerKit(WORKSPACE, KEY, "2026-01-01T00:00:00.000Z");
    const kit = JSON.parse(text) as Record<string, unknown>;

    expect(kit).toEqual({
      kind: "suite.owner",
      version: 1,
      workspaceId: WORKSPACE,
      ownerKey: KEY,
      exportedAt: "2026-01-01T00:00:00.000Z",
    });
    expect(text).not.toContain("document");
    expect(text).toContain("\n");
  });
});

describe("parseOwnerKit", () => {
  it("round-trips a kit", () => {
    expect(parseOwnerKit(createOwnerKit(WORKSPACE, KEY))).toEqual({
      workspaceId: WORKSPACE,
      ownerKey: KEY,
    });
  });

  it("accepts pretty-printed and whitespace-padded fields", () => {
    const text = JSON.stringify({
      kind: OWNER_KIT_KIND,
      version: 1,
      workspaceId: `  ${WORKSPACE}  `,
      ownerKey: ` ${KEY} `,
      exportedAt: "2026-01-01T00:00:00.000Z",
    });
    expect(parseOwnerKit(text)).toEqual({ workspaceId: WORKSPACE, ownerKey: KEY });
  });

  it("refuses a file that is not JSON or not an object", () => {
    expect(() => parseOwnerKit("not json")).toThrow("not a Suite recovery key");
    expect(() => parseOwnerKit("[]")).toThrow("not a Suite recovery key");
    expect(() => parseOwnerKit("null")).toThrow("not a Suite recovery key");
  });

  it("names a workspace backup rather than accepting it", () => {
    const backup = JSON.stringify({
      kind: "suite.workspace",
      version: 1,
      schemaVersion: 4,
      exportedAt: "2026-01-01T00:00:00.000Z",
      workspaceId: WORKSPACE,
      document: "eA==",
      manifest: { boards: 0, cards: 0, types: 0, tags: 0 },
    });
    expect(() => parseOwnerKit(backup)).toThrow("workspace backup");
  });

  it("refuses a future version by name", () => {
    const text = JSON.stringify({
      kind: OWNER_KIT_KIND,
      version: 2,
      workspaceId: WORKSPACE,
      ownerKey: KEY,
      exportedAt: "2026-01-01T00:00:00.000Z",
    });
    expect(() => parseOwnerKit(text)).toThrow("newer Suite");
    expect(() => parseOwnerKit(text)).toThrow("version 2");
  });

  it("reports each missing field", () => {
    const base = {
      kind: OWNER_KIT_KIND,
      version: 1,
      workspaceId: WORKSPACE,
      ownerKey: KEY,
      exportedAt: "2026-01-01T00:00:00.000Z",
    };

    expect(() => parseOwnerKit(JSON.stringify({ ...base, version: undefined }))).toThrow("version");
    expect(() => parseOwnerKit(JSON.stringify({ ...base, workspaceId: "" }))).toThrow("workspace");
    expect(() => parseOwnerKit(JSON.stringify({ ...base, ownerKey: "   " }))).toThrow("owner key");
    expect(() => parseOwnerKit(JSON.stringify({ ...base, exportedAt: "" }))).toThrow("export date");
    const { kind: _kind, ...withoutKind } = base;
    expect(() => parseOwnerKit(JSON.stringify(withoutKind))).toThrow("not a Suite recovery key");
  });
});

describe("assertOwnerKitWorkspace", () => {
  it("rejects a key from another workspace", () => {
    const kit = parseOwnerKit(createOwnerKit("ws-2", KEY));
    expect(() => assertOwnerKitWorkspace(kit, WORKSPACE)).toThrow(
      "That recovery key does not own this workspace.",
    );
    expect(() => assertOwnerKitWorkspace(kit, "ws-2")).not.toThrow();
  });
});

describe("downloadOwnerKit", () => {
  const blobs: Blob[] = [];
  let clicked: string[] = [];

  beforeEach(() => {
    blobs.length = 0;
    clicked = [];
    class StubURL extends URL {
      static override createObjectURL = (blob: Blob): string => {
        blobs.push(blob);
        return "blob:recovery";
      };
      static override revokeObjectURL = (): void => {};
    }
    vi.stubGlobal("URL", StubURL);
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      clicked.push(this.download);
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("downloads a .suitekey named after the workspace, never a .suite", async () => {
    const filename = downloadOwnerKit(WORKSPACE, KEY, "Research Notes");

    expect(filename).toBe("research-notes-recovery.suitekey");
    expect(clicked).toEqual(["research-notes-recovery.suitekey"]);
    expect(filename.endsWith(".suite")).toBe(false);

    const text = await blobs[0]?.text();
    expect(text).toBeDefined();
    expect(parseOwnerKit(text ?? "")).toEqual({ workspaceId: WORKSPACE, ownerKey: KEY });
    expect(hasSavedRecoveryKey(WORKSPACE)).toBe(true);

    clearSavedRecoveryKey(WORKSPACE);
    expect(hasSavedRecoveryKey(WORKSPACE)).toBe(false);
  });

  it("uses a stable stem for an untitled workspace", () => {
    expect(ownerKitFilename("")).toBe("workspace-recovery.suitekey");
    expect(ownerKitFilename("A/B — C")).toBe("a-b-c-recovery.suitekey");
  });
});
