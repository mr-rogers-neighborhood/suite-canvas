import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createShare,
  listShares,
  resolveShare,
  revokeShare,
  ShareApiError,
  shareErrorMessage,
  shareLink,
} from "./shares";

const API = "http://localhost:1235/api/shares";

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
      createShare({ workspaceId: "ws-1", scope: "workspace", role: "viewer" }),
    ).resolves.toEqual({ token: "tok-1", share });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const call = fetchMock.mock.calls[0];
    expect(call?.[0]).toBe(API);
    expect(call?.[1]?.method).toBe("POST");
    expect(call?.[1]?.headers).toEqual({ "content-type": "application/json" });
    expect(JSON.parse(String(call?.[1]?.body))).toEqual({
      workspaceId: "ws-1",
      scope: "workspace",
      role: "viewer",
    });
  });

  it("turns the server's error body into a readable error", async () => {
    stubFetch(() => reply({ error: "Board and card editor links are coming next." }, 400));

    const failure = createShare({
      workspaceId: "ws-1",
      scope: "board",
      role: "editor",
      boardId: "b-1",
    }).catch((error: unknown) => error);

    const error = await failure;
    expect(error).toBeInstanceOf(ShareApiError);
    expect(error).toMatchObject({
      message: "Board and card editor links are coming next.",
      status: 400,
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
      createShare({ workspaceId: "ws-1", scope: "workspace", role: "viewer" }),
    ).rejects.toThrow("Could not reach the share server.");
  });

  it("rejects an unexpected payload", async () => {
    stubFetch(() => reply({ token: 42 }));

    await expect(
      createShare({ workspaceId: "ws-1", scope: "workspace", role: "viewer" }),
    ).rejects.toThrow("The share server sent an unexpected response.");
  });
});

describe("listShares", () => {
  it("asks for one workspace's shares", async () => {
    const fetchMock = stubFetch(() => reply({ shares: [share] }));

    await expect(listShares("ws 1/2")).resolves.toEqual([share]);

    expect(fetchMock.mock.calls[0]?.[0]).toBe(`${API}?workspaceId=ws+1%2F2`);
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

    await expect(listShares("ws-1")).rejects.toThrow("The share request failed (502).");
  });
});

describe("resolveShare", () => {
  it("resolves a token", async () => {
    const fetchMock = stubFetch(() => reply({ share: { ...share, roomId: "share-tok-1" } }));

    await expect(resolveShare("tok-1")).resolves.toMatchObject({ roomId: "share-tok-1" });
    expect(fetchMock.mock.calls[0]?.[0]).toBe(`${API}/tok-1`);
  });

  it("surfaces a revoked token as an error", async () => {
    stubFetch(() => reply({ error: "Share not found." }, 404));

    await expect(resolveShare("gone")).rejects.toThrow("Share not found.");
  });
});

describe("revokeShare", () => {
  it("deletes by id", async () => {
    const fetchMock = stubFetch(() => reply({ share: { ...share, revokedAt: 5 } }));

    await expect(revokeShare("share-1")).resolves.toMatchObject({ revokedAt: 5 });
    const call = fetchMock.mock.calls[0];
    expect(call?.[0]).toBe(`${API}/share-1`);
    expect(call?.[1]?.method).toBe("DELETE");
  });
});

describe("shareLink", () => {
  it("builds a token-only recipient URL", () => {
    const url = new URL(shareLink("tok-1"));
    expect(url.searchParams.get("share")).toBe("tok-1");
    expect(url.searchParams.get("workspace")).toBeNull();
  });
});

describe("shareErrorMessage", () => {
  it("reads anything thrown", () => {
    expect(shareErrorMessage(new ShareApiError("Nope."))).toBe("Nope.");
    expect(shareErrorMessage(new Error("Broken."))).toBe("Broken.");
    expect(shareErrorMessage("odd")).toBe("The share request failed.");
  });
});
