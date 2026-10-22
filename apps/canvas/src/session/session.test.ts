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
import type { Share } from "./shares";

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

  it("never carries the owner workspace id for a board or card share", () => {
    // The API redacts the owner id for projections; even if it did not, the
    // session must only know the room.
    for (const scope of ["board", "card"] as const) {
      const config = sessionForShare("tok", share({ scope, roomId: "share-tok", workspaceId: "" }));
      expect(config.workspaceId).toBe("share-tok");
      expect(config.roomId).toBe("share-tok");
      expect(config.share?.workspaceId).toBe("share-tok");
      expect(config.readOnly).toBe(true);
    }
  });

  it("falls back to the projection room when the API omits it", () => {
    const config = sessionForShare("tok", share({ scope: "board", roomId: null }));
    expect(config.roomId).toBe("share-tok");
    expect(config.workspaceId).toBe("share-tok");
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
  ];

  it.each(cases)("grants $name exactly its matrix row", ({ config, readOnly, capabilities }) => {
    const resolved = config();
    expect(resolved.readOnly).toBe(readOnly);
    expect(sessionCapabilities(resolved)).toEqual(capabilities);
  });
});
