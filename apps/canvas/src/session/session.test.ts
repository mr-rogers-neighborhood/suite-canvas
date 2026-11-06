import { afterEach, describe, expect, it, vi } from "vitest";
import { configureSession, getSession, sessionCapabilities, standaloneSession } from "./session";

afterEach(() => {
  window.history.replaceState(null, "", "/");
  configureSession(standaloneSession({}));
});

describe("session config", () => {
  it("names the workspace in the URL, and nothing else", () => {
    window.history.replaceState(null, "", "/?workspace=ws-1");
    configureSession(standaloneSession({ workspaceId: "ws-1" }));
    expect(getSession()).toMatchObject({
      workspaceId: "ws-1",
      roomId: "ws-1",
      share: null,
      readOnly: false,
      credential: "none",
    });
  });

  it("strips everything a session used to carry when it is made local", () => {
    configureSession({
      workspaceId: "ws-1",
      roomId: "ws-1",
      share: null,
      role: "editor",
      readOnly: true,
      credential: "none",
    });
    configureSession(standaloneSession(getSession()));
    expect(getSession().readOnly).toBe(false);
  });

  it("keeps the document and drops the credential", () => {
    const session = standaloneSession({ workspaceId: "ws-9" });
    expect(session.credential).toBe("none");
    expect(session.share).toBeNull();
  });

  it("configures what every surface then reads", () => {
    configureSession(standaloneSession({ workspaceId: "ws-2" }));
    expect(getSession().workspaceId).toBe("ws-2");
  });
});

describe("session capabilities", () => {
  it("grants the local matrix to every session", () => {
    const capabilities = sessionCapabilities(standaloneSession({ workspaceId: "ws-1" }));
    expect(capabilities.canEditContent).toBe(true);
    expect(capabilities.canEditLayout).toBe(true);
    expect(capabilities.canCreateContent).toBe(true);
    expect(capabilities.canManageTrash).toBe(true);
    // The two rows that needed a service.
    expect(capabilities.canManageLinks).toBe(false);
    expect(capabilities.canPublish).toBe(false);
  });

  it("answers the same for a session that was never configured", () => {
    vi.resetModules();
    expect(sessionCapabilities().canEditContent).toBe(true);
  });
});
