import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deleteWorkspaceEverywhere, purgeWorkspaceLocally } from "./workspaceDelete";

const deleteDocument = vi.hoisted(() => vi.fn<(workspaceId: string) => Promise<void>>());

vi.mock("../collab/loroPersistence", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../collab/loroPersistence")>();
  return { ...actual, deleteWorkspaceDocument: deleteDocument };
});

const RECENTS = "suite.recentWorkspaces.v1";

function seed(workspaceId = "ws-1"): void {
  window.localStorage.setItem(`suite.owner.${workspaceId}`, "owner-key-1");
  window.localStorage.setItem(`suite.owner-claim.${workspaceId}`, "claimed");
  window.localStorage.setItem(
    `suite.recoverySaved.${workspaceId}`,
    JSON.stringify({ savedAt: 1_700_000_000_000 }),
  );
  window.localStorage.setItem(`suite.licence.${workspaceId}`, "licence-token");
  window.localStorage.setItem(
    RECENTS,
    JSON.stringify([
      { id: workspaceId, title: "Research", lastOpenedAt: 2 },
      { id: "ws-2", title: "Other", lastOpenedAt: 1 },
    ]),
  );
}

function recents(): { id: string }[] {
  return JSON.parse(window.localStorage.getItem(RECENTS) ?? "[]") as { id: string }[];
}

function localKeys(workspaceId = "ws-1"): (string | null)[] {
  return [
    window.localStorage.getItem(`suite.owner.${workspaceId}`),
    window.localStorage.getItem(`suite.owner-claim.${workspaceId}`),
    window.localStorage.getItem(`suite.recoverySaved.${workspaceId}`),
    window.localStorage.getItem(`suite.licence.${workspaceId}`),
  ];
}

beforeEach(() => {
  window.localStorage.clear();
  deleteDocument.mockReset();
  deleteDocument.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe("purgeWorkspaceLocally", () => {
  it("clears all five stores this browser holds for the workspace", async () => {
    seed();

    await purgeWorkspaceLocally("ws-1");

    expect(localKeys()).toEqual([null, null, null, null]);
    expect(recents().map((entry) => entry.id)).toEqual(["ws-2"]);
    expect(deleteDocument).toHaveBeenCalledTimes(1);
    expect(deleteDocument).toHaveBeenCalledWith("ws-1");
  });

  it("is idempotent and tolerates stores that never existed", async () => {
    seed();

    await purgeWorkspaceLocally("ws-1");
    await expect(purgeWorkspaceLocally("ws-1")).resolves.toBeUndefined();
    // A workspace this browser never touched, and an empty id.
    await expect(purgeWorkspaceLocally("ws-unknown")).resolves.toBeUndefined();
    await expect(purgeWorkspaceLocally("   ")).resolves.toBeUndefined();

    expect(localKeys()).toEqual([null, null, null, null]);
    expect(recents().map((entry) => entry.id)).toEqual(["ws-2"]);
  });

  it("still clears local storage when IndexedDB refuses", async () => {
    seed();
    deleteDocument.mockRejectedValue(new Error("no indexeddb"));

    await expect(purgeWorkspaceLocally("ws-1")).resolves.toBeUndefined();

    expect(localKeys()).toEqual([null, null, null, null]);
  });
});

describe("deleteWorkspaceEverywhere", () => {
  function stubFetch(response: Response): ReturnType<typeof vi.fn> {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => response);
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it("deletes on the relay with the owner key, then purges this browser", async () => {
    seed();
    const fetchMock = stubFetch(new Response(JSON.stringify({ deleted: true }), { status: 200 }));

    await deleteWorkspaceEverywhere({
      workspaceId: "ws-1",
      profile: "relay",
      ownerKey: "owner-key-1",
    });

    const call = fetchMock.mock.calls.at(0);
    expect(call?.[0]).toBe("http://localhost:1235/api/workspaces/ws-1");
    expect(call?.[1]?.method).toBe("DELETE");
    const headers = (call?.[1]?.headers ?? {}) as Record<string, string>;
    expect(headers.authorization).toBe("Bearer owner-key-1");
    expect(JSON.parse(String(call?.[1]?.body))).toEqual({ confirm: "ws-1" });

    expect(localKeys()).toEqual([null, null, null, null]);
    expect(deleteDocument).toHaveBeenCalledWith("ws-1");
  });

  it("leaves the local copy intact when the relay refuses", async () => {
    seed();
    stubFetch(
      new Response(JSON.stringify({ error: "The owner key does not match this workspace." }), {
        status: 403,
      }),
    );

    await expect(
      deleteWorkspaceEverywhere({ workspaceId: "ws-1", profile: "relay", ownerKey: "wrong-key" }),
    ).rejects.toThrow("does not match this workspace");

    expect(localKeys()).toEqual([
      "owner-key-1",
      "claimed",
      JSON.stringify({ savedAt: 1_700_000_000_000 }),
      "licence-token",
    ]);
    expect(recents()).toHaveLength(2);
    expect(deleteDocument).not.toHaveBeenCalled();
  });

  it("leaves the local copy intact when the relay cannot be reached", async () => {
    seed();
    const fetchMock = vi.fn(async () => {
      throw new Error("offline");
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      deleteWorkspaceEverywhere({ workspaceId: "ws-1", profile: "relay", ownerKey: "owner-key-1" }),
    ).rejects.toThrow("Could not reach the workspace server");

    expect(localKeys()[0]).toBe("owner-key-1");
    expect(deleteDocument).not.toHaveBeenCalled();
  });

  it("purges without a request in the standalone profile", async () => {
    seed();
    const fetchMock = stubFetch(new Response(null, { status: 200 }));

    await deleteWorkspaceEverywhere({ workspaceId: "ws-1", profile: "standalone" });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(localKeys()).toEqual([null, null, null, null]);
    expect(deleteDocument).toHaveBeenCalledWith("ws-1");
  });

  it("refuses a relay delete without an owner key", async () => {
    seed();
    const fetchMock = stubFetch(new Response(null, { status: 200 }));

    await expect(
      deleteWorkspaceEverywhere({ workspaceId: "ws-1", profile: "relay", ownerKey: null }),
    ).rejects.toThrow("no owner key");

    expect(fetchMock).not.toHaveBeenCalled();
    expect(localKeys()[0]).toBe("owner-key-1");
  });
});
