import { afterEach, describe, expect, it, vi } from "vitest";
import {
  configureSession,
  getSession,
  resolveShareToken,
  type SessionCapabilities,
  type SessionConfig,
  sessionCapabilities,
  sessionForShare,
} from "./session";
import { forgetShareSession, resolveShare, SHARE_SESSION_RESUME, type Share } from "./shares";

const share = (overrides: Partial<Share> = {}): Share => ({
  id: "share-1",
  scope: "workspace",
  role: "viewer",
  workspaceId: "workspace-1",
  boardId: null,
  cardId: null,
  createdAt: 0,
  revokedAt: null,
  expiresAt: null,
  roomId: "workspace-1",
  cardIds: [],
  cardCount: 0,
  ...overrides,
});

afterEach(() => {
  // Restore the URL-derived default for any later test in this file.
  configureSession({
    workspaceId: null,
    roomId: null,
    share: null,
    role: "editor",
    readOnly: false,
    ownerKey: null,
  });
  vi.unstubAllGlobals();
  forgetShareSession();
  window.history.replaceState(null, "", "/");
});

describe("session config", () => {
  it("defaults to an editable session with no workspace", () => {
    // jsdom runs without query parameters.
    expect(getSession()).toEqual({
      workspaceId: null,
      roomId: null,
      share: null,
      role: "editor",
      readOnly: false,
      ownerKey: null,
    });
    expect(resolveShareToken()).toBeNull();
  });

  it("derives the editable default from ?workspace= and ?doc=", async () => {
    window.history.pushState({}, "", "/?workspace=from-url");
    vi.resetModules();
    const fromWorkspace = await import("./session");
    expect(fromWorkspace.getSession()).toEqual({
      workspaceId: "from-url",
      roomId: "from-url",
      share: null,
      role: "editor",
      readOnly: false,
      ownerKey: null,
    });

    window.history.pushState({}, "", "/?doc=legacy-url");
    vi.resetModules();
    const fromDoc = await import("./session");
    expect(fromDoc.getSession()).toMatchObject({ workspaceId: "legacy-url", roomId: "legacy-url" });

    window.history.pushState({}, "", "/");
  });

  it("stores and returns a configured session", () => {
    configureSession({
      workspaceId: "ws",
      roomId: "ws",
      share: null,
      role: "editor",
      readOnly: false,
      ownerKey: "owner-key",
    });
    expect(getSession().workspaceId).toBe("ws");
    expect(getSession().ownerKey).toBe("owner-key");
  });

  it("resumes a token-free share URL from the session marker", () => {
    window.history.replaceState(null, "", "/#share-session");
    expect(resolveShareToken()).toBe(SHARE_SESSION_RESUME);

    // A token in the URL always wins: the exchange has not run yet.
    window.history.replaceState(null, "", "/?share=tok-1#share-session");
    expect(resolveShareToken()).toBe("tok-1");
  });

  it("presents the exchanged session instead of the link token", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          share: share({ scope: "board", roomId: "share-tok" }),
          session: "sess-1",
        }),
      })),
    );

    await resolveShare("tok");
    const config = sessionForShare("tok", share({ scope: "board", roomId: "share-tok" }));

    // The permanent token is no longer the credential this page presents.
    expect(config.share?.token).toBe("sess-1");
  });

  it("never uses the resume marker as a credential", () => {
    const config = sessionForShare(SHARE_SESSION_RESUME, share({ roomId: "workspace-1" }));

    // Without an exchange there is nothing to present, but a sentinel must never
    // reach a room join as if it were a capability.
    expect(config.share?.token).toBe("");
    expect(config.roomId).toBe("workspace-1");
  });

  it("keeps a workspace share editable only for its editor role", () => {
    const viewer = sessionForShare("token", share());
    expect(viewer).toMatchObject({
      workspaceId: "workspace-1",
      roomId: "workspace-1",
      role: "viewer",
      readOnly: true,
      ownerKey: null,
    });
    expect(viewer.share).toMatchObject({
      token: "token",
      scope: "workspace",
      roomId: "workspace-1",
    });

    const editor = sessionForShare("token2", share({ role: "editor" }));
    expect(editor.readOnly).toBe(false);
  });

  it("never carries the owner workspace id for a board, card or selection share", () => {
    // The API redacts the owner id for projections; even if it did not, the
    // session must only know the room.
    for (const scope of ["board", "card", "selection"] as const) {
      const config = sessionForShare("tok", share({ scope, roomId: "share-tok", workspaceId: "" }));
      expect(config.workspaceId).toBe("share-tok");
      expect(config.roomId).toBe("share-tok");
      expect(config.share?.workspaceId).toBe("share-tok");
      expect(config.readOnly).toBe(true);
    }
  });

  it("opens a selection share in the projection room", () => {
    const config = sessionForShare(
      "tok",
      share({
        scope: "selection",
        role: "viewer",
        boardId: "board-1",
        roomId: "share-tok",
        workspaceId: "owner-workspace",
        cardIds: [],
        cardCount: 3,
      }),
    );

    expect(config).toMatchObject({
      workspaceId: "share-tok",
      roomId: "share-tok",
      role: "viewer",
      readOnly: true,
      ownerKey: null,
    });
    expect(config.share).toMatchObject({
      token: "tok",
      scope: "selection",
      role: "viewer",
      workspaceId: "share-tok",
      boardId: "board-1",
      cardId: null,
      roomId: "share-tok",
    });
    // The owner's workspace id is nowhere in the session.
    expect(JSON.stringify(config)).not.toContain("owner-workspace");
  });

  it("falls back to the projection room when the API omits it", () => {
    const config = sessionForShare("tok", share({ scope: "board", roomId: null }));
    expect(config.roomId).toBe("share-tok");
    expect(config.workspaceId).toBe("share-tok");
  });

  it("falls back to the projection room for a selection share without a room id", () => {
    const config = sessionForShare(
      "tok",
      share({ scope: "selection", roomId: null, workspaceId: "owner-workspace", cardCount: 2 }),
    );
    expect(config.roomId).toBe("share-tok");
    expect(config.workspaceId).toBe("share-tok");
    expect(config.share?.scope).toBe("selection");
  });

  it("keeps a selection share read-only even if its role is not viewer", () => {
    const config = sessionForShare("tok", share({ scope: "selection", role: "editor" }));
    expect(config.readOnly).toBe(true);
    expect(sessionCapabilities(config).canEditContent).toBe(false);
  });
});

describe("session capabilities", () => {
  const owner: SessionConfig = {
    workspaceId: "ws",
    roomId: "ws",
    share: null,
    role: "editor",
    readOnly: false,
    ownerKey: "owner-key",
  };

  const NONE = {
    canEditContent: false,
    canEditLayout: false,
    canPublish: false,
    canCreateContent: false,
    canCreateBoards: false,
    canManageBoards: false,
    canManageSchema: false,
    canManageTrash: false,
    canManageLinks: false,
  } as const;

  function session(scope: Share["scope"], role: Share["role"]): SessionConfig {
    return sessionForShare("tok", share({ scope, role }));
  }

  const cases: Array<{
    name: string;
    config: () => SessionConfig;
    readOnly: boolean;
    capabilities: SessionCapabilities;
  }> = [
    {
      name: "the owner",
      config: () => owner,
      readOnly: false,
      capabilities: {
        canEditContent: true,
        canEditLayout: true,
        // An owner edits the live workspace; only a draft share publishes.
        canPublish: false,
        canCreateContent: true,
        canCreateBoards: true,
        canManageBoards: true,
        canManageSchema: true,
        canManageTrash: true,
        canManageLinks: true,
      },
    },
    {
      name: "a workspace editor token",
      config: () => session("workspace", "editor"),
      readOnly: false,
      capabilities: {
        canEditContent: true,
        canEditLayout: true,
        canPublish: false,
        canCreateContent: true,
        canCreateBoards: true,
        canManageBoards: true,
        canManageSchema: true,
        canManageTrash: true,
        canManageLinks: false,
      },
    },
    {
      name: "a board editor",
      config: () => session("board", "editor"),
      readOnly: false,
      capabilities: {
        canEditContent: true,
        canEditLayout: true,
        canPublish: true,
        canCreateContent: true,
        canCreateBoards: false,
        canManageBoards: false,
        canManageSchema: false,
        canManageTrash: false,
        canManageLinks: false,
      },
    },
    {
      name: "a card editor",
      config: () => session("card", "editor"),
      readOnly: false,
      capabilities: {
        canEditContent: true,
        canEditLayout: false,
        canPublish: true,
        canCreateContent: false,
        canCreateBoards: false,
        canManageBoards: false,
        canManageSchema: false,
        canManageTrash: false,
        canManageLinks: false,
      },
    },
    {
      name: "a workspace viewer",
      config: () => session("workspace", "viewer"),
      readOnly: true,
      capabilities: NONE,
    },
    {
      name: "a board viewer",
      config: () => session("board", "viewer"),
      readOnly: true,
      capabilities: NONE,
    },
    {
      name: "a card viewer",
      config: () => session("card", "viewer"),
      readOnly: true,
      capabilities: NONE,
    },
    {
      name: "a selection viewer",
      config: () => session("selection", "viewer"),
      readOnly: true,
      capabilities: NONE,
    },
  ];

  it.each(cases)("grants $name exactly its matrix row", ({ config, readOnly, capabilities }) => {
    const resolved = config();
    expect(resolved.readOnly).toBe(readOnly);
    expect(sessionCapabilities(resolved)).toEqual(capabilities);
  });

  it("never lets a selection viewer manage links", () => {
    const caps = sessionCapabilities(session("selection", "viewer"));
    expect(caps).toEqual(NONE);
    expect(caps.canManageLinks).toBe(false);
  });
});
