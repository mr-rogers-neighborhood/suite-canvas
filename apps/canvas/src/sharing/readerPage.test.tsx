import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  forgetShareSession,
  publishRefusalMessage,
  readerSlug,
  resolveShare,
  SHARE_REFUSAL_DRAFT_TOO_LARGE,
  SHARE_SESSION_FRAGMENT,
  SHARE_SESSION_RESUME,
  type Share,
  ShareApiError,
  SharePublishConflictError,
  shareErrorMessage,
  shareLink,
} from "../session/shares";
import { ShareUnavailable } from "./ShareUnavailable";

/**
 * The reader half of publishing: one address per published page, and a page
 * that says it was unpublished instead of rendering an empty canvas.
 */
const ORIGINAL = window.location.href;

/** The development relay base the share client falls back to in a test build. */
const COLLAB_HTTP = "http://localhost:1235";

afterEach(() => {
  vi.unstubAllGlobals();
  forgetShareSession();
  window.history.replaceState({}, "", ORIGINAL);
});

describe("the reader address", () => {
  it("puts the page name in the path and the capability in the query", () => {
    window.history.replaceState({}, "", "/?workspace=ws-1&board=b1#owner=secret");

    const url = new URL(shareLink("tok-1", "roadmap"));

    expect(url.pathname).toBe("/s/roadmap");
    expect(url.searchParams.get("share")).toBe("tok-1");
    expect(url.searchParams.get("workspace")).toBeNull();
    expect(url.searchParams.get("board")).toBeNull();
    expect(url.hash).toBe("");
  });

  it("keeps the page name out of escaping range", () => {
    const url = new URL(shareLink("tok-1", "a/b c"));

    expect(url.pathname).toBe("/s/a%2Fb%20c");
    expect(readerSlug(url.toString())).toBe("a/b c");
  });

  it("falls back to the page that made the link when the share has no slug", () => {
    window.history.replaceState({}, "", "/?workspace=ws-1");

    const url = new URL(shareLink("tok-1", null));

    expect(url.pathname).toBe("/");
    expect(url.searchParams.get("share")).toBe("tok-1");
  });

  it("reads a slug out of a reader address and nothing out of another page", () => {
    expect(readerSlug("https://app.suite.run/s/roadmap?share=tok#share-session")).toBe("roadmap");
    expect(readerSlug("https://app.suite.run/s/roadmap/")).toBe("roadmap");
    expect(readerSlug("https://app.suite.run/?workspace=ws-1")).toBeNull();
    expect(readerSlug("https://app.suite.run/s/")).toBeNull();
    expect(readerSlug(null)).toBeNull();
  });
});

describe("a revoked page", () => {
  it("says the page was unpublished rather than showing an empty canvas", () => {
    render(<ShareUnavailable message="Share not found." page="roadmap" />);

    expect(screen.getByTestId("share-unavailable")).toBeInTheDocument();
    expect(screen.getByRole("heading")).toHaveTextContent("This page was unpublished.");
    expect(screen.getByText(/revoked the link to roadmap/u)).toBeInTheDocument();
    expect(screen.getByTestId("share-error")).toHaveTextContent("Share not found.");
  });

  it("names the page from the address when the shell has nothing else", () => {
    window.history.replaceState({}, "", "/s/roadmap#share-session");

    render(<ShareUnavailable />);

    expect(screen.getByText(/revoked the link to roadmap/u)).toBeInTheDocument();
  });
});

describe("revisiting a revoked page", () => {
  it("fails the resume and leaves the reader with the unpublished page", async () => {
    window.history.replaceState({}, "", "/s/roadmap#share-session");
    // A revoked share answers 404 to the cookie: the store drops the row, so
    // the session cannot come back either.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 404,
        json: async () => ({ error: "Share not found." }),
      })),
    );

    const failure = await resolveShare(SHARE_SESSION_RESUME).catch((cause: unknown) => cause);
    expect(failure).toBeInstanceOf(ShareApiError);

    render(<ShareUnavailable message={shareErrorMessage(failure)} />);
    expect(screen.getByRole("heading")).toHaveTextContent("This page was unpublished.");
    expect(screen.getByText(/revoked the link to roadmap/u)).toBeInTheDocument();
    // No empty canvas: the shell renders this stand-in instead of the editor.
    expect(screen.getByTestId("share-unavailable")).toBeInTheDocument();
  });
});

describe("the publish size cap", () => {
  it("is a named refusal the editor can repeat", () => {
    const error = new SharePublishConflictError({
      conflicts: [],
      unsupported: [
        {
          key: "publish:size",
          kind: "unsupported",
          message: "The draft holds 900 bytes; publishing is limited to 800 bytes.",
        },
      ],
      reason: null,
      code: SHARE_REFUSAL_DRAFT_TOO_LARGE,
    });

    expect(publishRefusalMessage(error.conflict.code)).toContain("over the publish size limit");
    expect(error.message).toContain("nothing was published");
    // The wall has a name, so a dialog can headline it instead of quoting bytes.
    expect(error.conflict.code).toBe("draft-too-large");
  });

  it("leaves an unnamed refusal to its own message", () => {
    expect(publishRefusalMessage("something-else")).toBeNull();
  });
});

/** A record the relay returns for a published card. */
function publishedCard(): Share {
  return {
    id: "share-1",
    scope: "card",
    role: "viewer",
    workspaceId: "share-tok-1",
    boardId: "board-1",
    cardId: "card-1",
    createdAt: 1_700_000_000_000,
    revokedAt: null,
    expiresAt: null,
    lastUsedAt: null,
    roomId: "share-tok-1",
    cardIds: [],
    cardCount: 1,
    slug: "roadmap",
  };
}

describe("revisiting a published page", () => {
  it("settles the address on the page name and resumes from the session cookie", async () => {
    window.history.replaceState({}, "", "/s/roadmap?share=tok-1");
    const share = publishedCard();
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => ({
      ok: true,
      status: 200,
      json: async () => ({ share, session: "sess-1" }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(resolveShare("tok-1")).resolves.toMatchObject({ slug: "roadmap" });

    // The token leaves the address bar; the page name stays, so a reload lands
    // on the same page rather than on a nameless root.
    expect(window.location.pathname).toBe("/s/roadmap");
    expect(window.location.search).toBe("");
    expect(window.location.hash).toBe(SHARE_SESSION_FRAGMENT);

    // A reload carries no token and needs no account: the cookie is the
    // credential and the resume marker says to use it.
    await expect(resolveShare(SHARE_SESSION_RESUME)).resolves.toMatchObject({ slug: "roadmap" });
    expect(fetchMock.mock.calls[1]?.[0]).toBe(`${COLLAB_HTTP}/api/shares/session`);
    expect(fetchMock.mock.calls[1]?.[1]?.credentials).toBe("include");
  });
});
