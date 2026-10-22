import { afterEach, describe, expect, it, vi } from "vitest";
import {
  configureSession,
  getSession,
  resolveShareToken,
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
  const owner = {
    workspaceId: "ws",
    roomId: "ws",
    share: null,
    role: "editor" as const,
    readOnly: false,
    ownerKey: "owner-key",
  };

  it("grants the owner everything", () => {
    expect(sessionCapabilities(owner)).toEqual({
      canEditContent: true,
      canEditLayout: true,
      canPublish: true,
      canCreate: true,
      canManage: true,
    });
  });

  it("grants every viewer nothing, whatever the scope", () => {
    for (const scope of ["workspace", "board", "card"] as const) {
      const config = sessionForShare("tok", share({ scope, role: "viewer" }));
      expect(sessionCapabilities(config)).toEqual({
        canEditContent: false,
        canEditLayout: false,
        canPublish: false,
        canCreate: false,
        canManage: false,
      });
      expect(config.readOnly).toBe(true);
    }
  });

  it("lets a board editor change content and layout, not create or manage", () => {
    const config = sessionForShare("tok", share({ scope: "board", role: "editor" }));
    expect(config.readOnly).toBe(false);
    expect(sessionCapabilities(config)).toEqual({
      canEditContent: true,
      canEditLayout: true,
      canPublish: true,
      canCreate: false,
      canManage: false,
    });
  });

  it("lets a card editor change content only", () => {
    const config = sessionForShare("tok", share({ scope: "card", role: "editor" }));
    expect(config.readOnly).toBe(false);
    expect(sessionCapabilities(config)).toEqual({
      canEditContent: true,
      canEditLayout: false,
      canPublish: true,
      canCreate: false,
      canManage: false,
    });
  });

  it("gives a workspace editor link the owner's capabilities", () => {
    const config = sessionForShare("tok", share({ scope: "workspace", role: "editor" }));
    expect(sessionCapabilities(config).canCreate).toBe(true);
    expect(sessionCapabilities(config).canManage).toBe(true);
  });
});
