import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deleteWorkspaceEverywhere, purgeWorkspaceLocally } from "./workspaceDelete";

const deleteDocument = vi.hoisted(() => vi.fn<(workspaceId: string) => Promise<void>>());

vi.mock("../collab/loroPersistence", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../collab/loroPersistence")>();
  return { ...actual, deleteWorkspaceDocument: deleteDocument };
});

const RECENTS = "suite.recentWorkspaces.v1";

function seed(workspaceId = "ws-1"): void {
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
  return [window.localStorage.getItem(`suite.licence.${workspaceId}`)];
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
  it("clears every store this browser holds for the workspace", async () => {
    seed();

    await purgeWorkspaceLocally("ws-1");

    expect(localKeys()).toEqual([null]);
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

    expect(localKeys()).toEqual([null]);
    expect(recents().map((entry) => entry.id)).toEqual(["ws-2"]);
  });

  it("still clears local storage when IndexedDB refuses", async () => {
    seed();
    deleteDocument.mockRejectedValue(new Error("no indexeddb"));

    await expect(purgeWorkspaceLocally("ws-1")).resolves.toBeUndefined();

    expect(localKeys()).toEqual([null]);
  });
});

describe("deleteWorkspaceEverywhere", () => {
  function stubFetch(response: Response): ReturnType<typeof vi.fn> {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => response);
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  const CREDENTIAL = { authorization: "Bearer session-jwt-1" };

  it("deletes on the relay with the session credential, then purges this browser", async () => {
    seed();
    const fetchMock = stubFetch(new Response(JSON.stringify({ deleted: true }), { status: 200 }));

    await deleteWorkspaceEverywhere({
      workspaceId: "ws-1",
      profile: "relay",
      authorization: async () => CREDENTIAL,
    });

    const call = fetchMock.mock.calls.at(0);
    expect(call?.[0]).toBe("http://localhost:1235/api/workspaces/ws-1");
    expect(call?.[1]?.method).toBe("DELETE");
    const headers = (call?.[1]?.headers ?? {}) as Record<string, string>;
    expect(headers.authorization).toBe(CREDENTIAL.authorization);
    expect(JSON.parse(String(call?.[1]?.body))).toEqual({ confirm: "ws-1" });

    expect(localKeys()).toEqual([null]);
    expect(deleteDocument).toHaveBeenCalledWith("ws-1");
  });

  it("leaves the local copy intact when the relay refuses", async () => {
    seed();
    stubFetch(
      new Response(JSON.stringify({ error: "You are not a member of this workspace." }), {
        status: 403,
      }),
    );

    await expect(
      deleteWorkspaceEverywhere({
        workspaceId: "ws-1",
        profile: "relay",
        authorization: async () => CREDENTIAL,
      }),
    ).rejects.toThrow("may not delete this workspace");

    expect(localKeys()).toEqual(["licence-token"]);
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
      deleteWorkspaceEverywhere({
        workspaceId: "ws-1",
        profile: "relay",
        authorization: async () => CREDENTIAL,
      }),
    ).rejects.toThrow("Could not reach the workspace server");

    expect(localKeys()).toEqual(["licence-token"]);
    expect(deleteDocument).not.toHaveBeenCalled();
  });

  it("purges without a request in the standalone profile", async () => {
    seed();
    const fetchMock = stubFetch(new Response(null, { status: 200 }));

    await deleteWorkspaceEverywhere({ workspaceId: "ws-1", profile: "standalone" });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(localKeys()).toEqual([null]);
    expect(deleteDocument).toHaveBeenCalledWith("ws-1");
  });

  it("refuses a relay delete with no session credential, sending nothing", async () => {
    seed();
    const fetchMock = stubFetch(new Response(null, { status: 200 }));

    await expect(
      deleteWorkspaceEverywhere({
        workspaceId: "ws-1",
        profile: "relay",
        authorization: async () => {
          throw new Error("This browser has no account session");
        },
      }),
    ).rejects.toThrow("no account session");

    expect(fetchMock).not.toHaveBeenCalled();
    expect(localKeys()).toEqual(["licence-token"]);
  });
});
