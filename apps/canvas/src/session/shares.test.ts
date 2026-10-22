import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createShare,
  listShares,
  publishShare,
  reloadShare,
  resolveShare,
  revokeShare,
  ShareApiError,
  SharePublishConflictError,
  shareErrorMessage,
  shareLink,
  shareStatus,
} from "./shares";

const API = "http://localhost:1235/api/shares";
const OWNER_KEY = "owner-key-1";
const OWNER_HEADER = { authorization: `Bearer ${OWNER_KEY}` };

const share = {
  id: "share-1",
  scope: "workspace" as const,
  role: "viewer" as const,
  workspaceId: "ws-1",
  boardId: null,
  cardId: null,
  createdAt: 1_700_000_000_000,
  revokedAt: null,
  roomId: "ws-1",
};

function reply(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

function stubFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const mock = vi.fn(handler);
  vi.stubGlobal("fetch", mock);
  return mock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createShare", () => {
  it("posts the input as JSON and returns the one-time token", async () => {
    const fetchMock = stubFetch(() => reply({ token: "tok-1", share }, 201));

    await expect(
      createShare({ workspaceId: "ws-1", scope: "workspace", role: "viewer" }, OWNER_KEY),
    ).resolves.toEqual({ token: "tok-1", share });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const call = fetchMock.mock.calls[0];
    expect(call?.[0]).toBe(API);
    expect(call?.[1]?.method).toBe("POST");
    expect(call?.[1]?.headers).toEqual({ ...OWNER_HEADER, "content-type": "application/json" });
    expect(JSON.parse(String(call?.[1]?.body))).toEqual({
      workspaceId: "ws-1",
      scope: "workspace",
      role: "viewer",
    });
  });

  it("turns the server's error body into a readable error", async () => {
    stubFetch(() => reply({ error: "This workspace is protected by a different owner key." }, 403));

    const failure = createShare(
      {
        workspaceId: "ws-1",
        scope: "board",
        role: "editor",
        boardId: "b-1",
      },
      OWNER_KEY,
    ).catch((error: unknown) => error);

    const error = await failure;
    expect(error).toBeInstanceOf(ShareApiError);
    expect(error).toMatchObject({
      message: "This workspace is protected by a different owner key.",
      status: 403,
    });
  });

  it("reports a server that cannot be reached", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );

    await expect(
      createShare({ workspaceId: "ws-1", scope: "workspace", role: "viewer" }, OWNER_KEY),
    ).rejects.toThrow("Could not reach the share server.");
  });

  it("rejects an unexpected payload", async () => {
    stubFetch(() => reply({ token: 42 }));

    await expect(
      createShare({ workspaceId: "ws-1", scope: "workspace", role: "viewer" }, OWNER_KEY),
    ).rejects.toThrow("The share server sent an unexpected response.");
  });
});

describe("listShares", () => {
  it("asks for one workspace's shares", async () => {
    const fetchMock = stubFetch(() => reply({ shares: [share] }));

    await expect(listShares("ws 1/2", OWNER_KEY)).resolves.toEqual([share]);

    expect(fetchMock.mock.calls[0]?.[0]).toBe(`${API}?workspaceId=ws+1%2F2`);
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toEqual(OWNER_HEADER);
  });

  it("falls back to a status message when the body is not JSON", async () => {
    stubFetch(
      () =>
        ({
          ok: false,
          status: 502,
          json: async () => {
            throw new SyntaxError("not json");
          },
        }) as unknown as Response,
    );

    await expect(listShares("ws-1", OWNER_KEY)).rejects.toThrow("The share request failed (502).");
  });
});

describe("resolveShare", () => {
  it("resolves a token", async () => {
    const fetchMock = stubFetch(() => reply({ share: { ...share, roomId: "share-tok-1" } }));

    await expect(resolveShare("tok-1")).resolves.toMatchObject({ roomId: "share-tok-1" });
    expect(fetchMock.mock.calls[0]?.[0]).toBe(`${API}/tok-1`);
    // Resolving stays public: no credential is sent with it.
    expect(fetchMock.mock.calls[0]?.[1]).toBeUndefined();
  });

  it("surfaces a revoked token as an error", async () => {
    stubFetch(() => reply({ error: "Share not found." }, 404));

    await expect(resolveShare("gone")).rejects.toThrow("Share not found.");
  });
});

describe("revokeShare", () => {
  it("deletes by id", async () => {
    const fetchMock = stubFetch(() => reply({ share: { ...share, revokedAt: 5 } }));

    await expect(revokeShare("share-1", OWNER_KEY)).resolves.toMatchObject({ revokedAt: 5 });
    const call = fetchMock.mock.calls[0];
    expect(call?.[0]).toBe(`${API}/share-1`);
    expect(call?.[1]?.method).toBe("DELETE");
    expect(call?.[1]?.headers).toEqual(OWNER_HEADER);
  });
});

describe("shareLink", () => {
  it("builds a token-only recipient URL", () => {
    const url = new URL(shareLink("tok-1"));
    expect(url.searchParams.get("share")).toBe("tok-1");
    expect(url.searchParams.get("workspace")).toBeNull();
  });

  it("never carries the owner fragment of the editor page", () => {
    window.history.replaceState({}, "", "/?workspace=ws-1&board=b1#owner=secret");
    try {
      const url = new URL(shareLink("tok-1"));
      expect(url.hash).toBe("");
      expect(url.searchParams.get("board")).toBeNull();
    } finally {
      window.history.replaceState({}, "", "/");
    }
  });
});

describe("owner key", () => {
  it("refuses a management call without a key instead of sending none", async () => {
    const fetchMock = stubFetch(() => reply({ shares: [] }));

    await expect(listShares("ws-1", null)).rejects.toThrow(
      "An owner key is required to manage links.",
    );
    await expect(
      createShare({ workspaceId: "ws-1", scope: "workspace", role: "viewer" }, ""),
    ).rejects.toThrow("An owner key is required to manage links.");
    await expect(revokeShare("share-1", "   ")).rejects.toThrow(
      "An owner key is required to manage links.",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("surfaces a rejected key as a readable error", async () => {
    stubFetch(() => reply({ error: "This workspace is protected by a different owner key." }, 403));

    await expect(listShares("ws-1", "wrong")).rejects.toMatchObject({
      message: "This workspace is protected by a different owner key.",
      status: 403,
    });
  });
});

describe("publishShare", () => {
  const VERSION = { "1": 3, "7": 1 };

  it("posts the share version with a bearer credential", async () => {
    const fetchMock = stubFetch(() => reply({ applied: 2 }));

    await expect(publishShare("tok-1", VERSION)).resolves.toEqual({ applied: 2 });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const call = fetchMock.mock.calls[0];
    expect(call?.[0]).toBe(`${API}/tok-1/publish`);
    expect(call?.[1]?.method).toBe("POST");
    expect(call?.[1]?.headers).toEqual({
      authorization: ["Bearer", "tok-1"].join(" "),
      "content-type": "application/json",
    });
    expect(JSON.parse(String(call?.[1]?.body))).toEqual({ version: VERSION });
  });

  it("tolerates a success body without a count", async () => {
    stubFetch(() => reply({}));
    await expect(publishShare("tok-1", VERSION)).resolves.toEqual({ applied: 0 });
  });

  it("turns a 409 into a typed conflict without losing the field keys", async () => {
    stubFetch(() =>
      reply(
        {
          conflicts: [{ key: "card:c1:body", kind: "body", message: "Body changed." }],
          unsupported: [
            {
              key: "card:c2",
              kind: "unsupported",
              message: "New cards cannot be published.",
              label: null,
            },
          ],
          reason: "The workspace changed.",
        },
        409,
      ),
    );

    const error = await publishShare("tok-1", VERSION).catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(SharePublishConflictError);
    const conflict = (error as SharePublishConflictError).conflict;
    expect(conflict.conflicts).toEqual([
      { key: "card:c1:body", kind: "body", message: "Body changed.", label: null },
    ]);
    expect(conflict.unsupported).toEqual([
      {
        key: "card:c2",
        kind: "unsupported",
        message: "New cards cannot be published.",
        label: null,
      },
    ]);
    expect(conflict.reason).toBe("The workspace changed.");
    expect((error as Error).message).toBe("The workspace changed.");
  });

  it("reads a string conflict list from an older server", async () => {
    stubFetch(() => reply({ conflicts: ["card:c1:title changed"] }, 409));

    const error = (await publishShare("tok-1", VERSION).catch(
      (cause) => cause,
    )) as SharePublishConflictError;
    expect(error.conflict.conflicts).toEqual([
      { key: "card:c1:title changed", message: "card:c1:title changed", kind: null, label: null },
    ]);
    expect(error.conflict.unsupported).toEqual([]);
  });

  it("sends the selected conflicts as the overwrite list", async () => {
    const fetchMock = stubFetch(() => reply({ applied: 1 }));

    await publishShare("tok-1", VERSION, ["card:c1:body"]);
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      version: VERSION,
      overwrite: ["card:c1:body"],
    });

    // An empty selection is meaningful: keep every workspace value.
    await publishShare("tok-1", VERSION, []);
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({
      version: VERSION,
      overwrite: [],
    });
  });

  it("surfaces a rejected token as a readable error", async () => {
    stubFetch(() => reply({ error: "This link is read-only." }, 403));
    await expect(publishShare("viewer-token", VERSION)).rejects.toMatchObject({
      message: "This link is read-only.",
      status: 403,
    });
  });
});

describe("shareStatus", () => {
  it("reads the draft status with the share token", async () => {
    const fetchMock = stubFetch(() => reply({ dirty: true, hasBaseline: true }));

    await expect(shareStatus("tok-1")).resolves.toEqual({ dirty: true, hasBaseline: true });

    expect(fetchMock.mock.calls[0]?.[0]).toBe(`${API}/tok-1/status`);
    expect(fetchMock.mock.calls[0]?.[1]?.method).toBeUndefined();
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toEqual({
      authorization: ["Bearer", "tok-1"].join(" "),
    });
  });

  it("defaults a sparse status body to false", async () => {
    stubFetch(() => reply({}));
    await expect(shareStatus("tok-1")).resolves.toEqual({ dirty: false, hasBaseline: false });
  });

  it("surfaces a rejected token", async () => {
    stubFetch(() => reply({ error: "Only an editor link has a publish status." }, 403));
    await expect(shareStatus("viewer-token")).rejects.toMatchObject({
      message: "Only an editor link has a publish status.",
      status: 403,
    });
  });
});

describe("reloadShare", () => {
  it("posts to the reload endpoint with the token", async () => {
    const fetchMock = stubFetch(() => reply({ reloaded: true }));

    await expect(reloadShare("tok-2")).resolves.toBeUndefined();
    expect(fetchMock.mock.calls[0]?.[0]).toBe(`${API}/tok-2/reload`);
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toEqual({ authorization: "Bearer tok-2" });
    expect(fetchMock.mock.calls[0]?.[1]?.body).toBeUndefined();
  });

  it("reports a reload failure", async () => {
    stubFetch(() => reply({ error: "This link is no longer available." }, 404));
    await expect(reloadShare("gone")).rejects.toMatchObject({
      message: "This link is no longer available.",
      status: 404,
    });
  });
});

describe("shareErrorMessage", () => {
  it("reads anything thrown", () => {
    expect(shareErrorMessage(new ShareApiError("Nope."))).toBe("Nope.");
    expect(shareErrorMessage(new Error("Broken."))).toBe("Broken.");
    expect(shareErrorMessage("odd")).toBe("The share request failed.");
  });
});
