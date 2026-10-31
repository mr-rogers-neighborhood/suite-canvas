import { afterEach, describe, expect, it } from "vitest";
import { configureSession } from "../session/session";
import { announceUploadRefusal, UPLOAD_IS_PAID } from "./uploadRefusal";
import { useAccountStore } from "./useAccountStore";

function reset(): void {
  useAccountStore.setState({
    panelOpen: false,
    panelTab: "account",
    dialogOpen: false,
    dialogMode: "sign-in",
    upgrade: null,
  });
}

afterEach(reset);

describe("routing a refused upload", () => {
  it("should open the plan tab when the reader already has an account", () => {
    configureSession({
      workspaceId: "ws-1",
      roomId: "ws-1",
      share: null,
      role: "editor",
      readOnly: false,
      credential: "account",
    });
    reset();

    announceUploadRefusal({ allowed: false, reason: "Uploads need a plan.", tier: "free" });

    const state = useAccountStore.getState();
    expect(state.panelOpen).toBe(true);
    expect(state.panelTab).toBe("plan");
    // Nothing to sign up for: the account exists, the plan does not.
    expect(state.dialogOpen).toBe(false);
    expect(state.upgrade?.message).toBe("Uploads need a plan.");
  });

  it("should ask for an account first when there is none, and say uploads are paid", () => {
    configureSession({
      workspaceId: "ws-1",
      roomId: "ws-1",
      share: null,
      role: "editor",
      readOnly: false,
      credential: "none",
    });
    reset();

    announceUploadRefusal({ allowed: false, tier: "free" });

    const state = useAccountStore.getState();
    expect(state.dialogOpen).toBe(true);
    expect(state.dialogMode).toBe("sign-up");
    expect(state.panelOpen).toBe(false);
    // Signing up alone does not buy an upload, so the prompt has to say so.
    expect(state.upgrade?.message).toContain(UPLOAD_IS_PAID);
  });

  it("should treat a share session as signed out, because a link cannot buy a plan", () => {
    configureSession({
      workspaceId: "ws-1",
      roomId: "ws-1",
      share: null,
      role: "viewer",
      readOnly: true,
      credential: "share",
    });
    reset();

    announceUploadRefusal();

    expect(useAccountStore.getState().dialogOpen).toBe(true);
    expect(useAccountStore.getState().panelOpen).toBe(false);
  });
});
