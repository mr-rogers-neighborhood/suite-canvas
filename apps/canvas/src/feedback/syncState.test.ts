import { describe, expect, it } from "vitest";
import {
  LOCAL_LABEL,
  OFFLINE_SENTENCE,
  pendingLabel,
  REFUSED_SENTENCE,
  syncPresentation,
} from "./syncState";

const base = { signedIn: true, peerCount: 0, pending: 0 };

describe("the one status reading", () => {
  it("reads a signed-out browser as local, whatever the socket did", () => {
    // No session means no credential was ever presented, so a refusal cannot
    // have happened. The relay said nothing about this browser.
    for (const status of ["unauthorized", "disconnected", "connecting", "connected"] as const) {
      const reading = syncPresentation({ ...base, signedIn: false, status });
      expect(reading.label).toBe(LOCAL_LABEL);
      expect(reading.tone).toBe("muted");
      expect(reading.action).toBe("signIn");
      expect(reading.sentence).not.toMatch(/refused/i);
    }
  });

  it("keeps a refusal a refusal while there is a session to refuse", () => {
    const reading = syncPresentation({ ...base, status: "unauthorized" });
    expect(reading.label).toBe("No access");
    expect(reading.sentence).toBe(REFUSED_SENTENCE);
    expect(reading.tone).toBe("warn");
  });

  it("treats a share link as its own credential, not as a signed-out account", () => {
    const reading = syncPresentation({
      ...base,
      signedIn: false,
      role: "viewer",
      status: "connected",
    });
    expect(reading.label).toBe("Synced");
    expect(reading.sentence).toBe("You are viewing this workspace.");
  });

  it("names the connection in one word each", () => {
    const label = (status: Parameters<typeof syncPresentation>[0]["status"]) =>
      syncPresentation({ ...base, status }).label;
    expect(label("connected")).toBe("Synced");
    expect(label("connecting")).toBe("Syncing");
    expect(label("rejoining")).toBe("Syncing");
    expect(label("disconnected")).toBe("Offline");
    expect(label("unauthorized")).toBe("No access");
  });

  it("offers a retry only when the connection dropped", () => {
    expect(syncPresentation({ ...base, status: "disconnected" }).action).toBe("retry");
    expect(syncPresentation({ ...base, status: "connected" }).action).toBeNull();
    expect(syncPresentation({ ...base, status: "unauthorized" }).action).toBeNull();
  });

  it("counts the room including the reader", () => {
    expect(syncPresentation({ ...base, status: "connected" }).sentence).toBe(
      "You are the only one here.",
    );
    expect(syncPresentation({ ...base, status: "connected", peerCount: 2 }).sentence).toBe(
      "3 here, including you.",
    );
  });

  it("says what the connection means for the work, not just that it dropped", () => {
    expect(syncPresentation({ ...base, status: "disconnected" }).sentence).toBe(OFFLINE_SENTENCE);
    expect(OFFLINE_SENTENCE).toContain("a reload needs the network");
  });
});

describe("the unsent count", () => {
  it("is silent when the relay has seen everything", () => {
    expect(pendingLabel(0)).toBeNull();
    expect(syncPresentation({ ...base, status: "connected", pending: 0 }).pending).toBeNull();
  });

  it("counts changes, in the singular when there is one", () => {
    expect(pendingLabel(1)).toBe("1 unsent change");
    expect(pendingLabel(12)).toBe("12 unsent changes");
  });

  it("does not claim anything is waiting when there is no session to send it", () => {
    expect(
      syncPresentation({ ...base, signedIn: false, status: "disconnected", pending: 9 }).pending,
    ).toBeNull();
  });
});
