import { describe, expect, it } from "vitest";
import {
  CAPPED_SENTENCE,
  EXPIRED_SENTENCE,
  LOCAL_SENTENCE,
  limitSentence,
  OFFLINE_SENTENCE,
  refusalSentence,
  syncPresentation,
} from "./syncState";

const base = {
  phase: "signed-in" as const,
  claim: "claimed" as const,
  status: "connected" as const,
  peerCount: 0,
};

describe("the one status reading", () => {
  it("reads a browser with no account as saved, whatever the socket did", () => {
    // No session means no credential was ever presented, so a refusal cannot have
    // happened, and this is the state the product is designed for.
    for (const status of ["unauthorized", "disconnected", "connecting", "connected"] as const) {
      const reading = syncPresentation({ ...base, phase: "signed-out", status });
      expect(reading.situation).toBe("local");
      expect(reading.label).toBe("Saved");
      expect(reading.tone).toBe("muted");
      expect(reading.action).toBe("signIn");
      expect(reading.sentence).toBe(LOCAL_SENTENCE);
    }
  });

  it("offers nothing until the page knows who it is", () => {
    const reading = syncPresentation({ ...base, phase: "unknown", status: "disconnected" });
    expect(reading.situation).toBe("local");
    expect(reading.action).toBeNull();
  });

  it("reads a workspace the plan does not cover as local, with the plan as the action", () => {
    const reading = syncPresentation({ ...base, claim: "capped", status: "unauthorized" });
    expect(reading.situation).toBe("capped");
    expect(reading.label).toBe("Local");
    expect(reading.sentence).toBe(CAPPED_SENTENCE);
    expect(reading.action).toBe("seePlans");
  });

  it("believes a live room over a claim the account does not cover", () => {
    // A member invited into somebody else's organization: their own account holds no
    // plan, so the claim comes back capped, while they sit in the room with the owner.
    // "2 here, including you" and "Local" in the same breath is a badge arguing with
    // its own sentence.
    const reading = syncPresentation({
      ...base,
      claim: "capped",
      status: "connected",
      peerCount: 1,
    });
    expect(reading.situation).toBe("synced");
    expect(reading.label).toBe("Synced");
    expect(reading.sentence).toContain("including you");
  });

  it("still reads as capped when the relay actually refused", () => {
    const reading = syncPresentation({ ...base, claim: "capped", status: "unauthorized" });
    expect(reading.situation).toBe("capped");
  });

  it("still reads as capped while the connect is in progress and nothing has arrived", () => {
    const reading = syncPresentation({ ...base, claim: "capped", status: "disconnected" });
    expect(reading.situation).toBe("capped");
  });

  it("reads a licence that covers nothing as the plan, with the button that fixes it", () => {
    // The relay refuses the join for an account whose licence covers no workspace, and the
    // workspace is exactly where it was. "Needs attention" would be a fault report; this is
    // a prompt.
    const reading = syncPresentation({ ...base, reason: "plan", status: "unauthorized" });

    expect(reading.situation).toBe("capped");
    expect(reading.label).toBe("Local");
    expect(reading.sentence).toBe(CAPPED_SENTENCE);
    expect(reading.action).toBe("seePlans");
    expect(reading.retryable).toBe(true);
  });

  it("says a paid plan is full rather than unpaid, and offers no retry", () => {
    // The report that produced this: a personal plan with three workspaces, three of them
    // synced, and a fourth refused with "your plan does not cover this workspace" beside an
    // "I have paid — retry" button that could not work.
    const reading = syncPresentation({
      ...base,
      reason: "limit",
      status: "unauthorized",
      ceiling: 3,
    });

    expect(reading.situation).toBe("capped");
    expect(reading.sentence).toBe(
      "Saved here. This plan covers 3 synced workspaces and they are all in use, so this one stays on this device.",
    );
    expect(reading.retryable).toBe(false);
    expect(reading.action).toBe("seePlans");
  });

  it("keeps a full plan's sentence usable when the token does not say the number", () => {
    const reading = syncPresentation({ ...base, reason: "limit", status: "unauthorized" });

    expect(reading.sentence).toBe(limitSentence(null));
    expect(reading.sentence).not.toBe(CAPPED_SENTENCE);
  });

  it("sends an ended session to sign in rather than calling it a refusal", () => {
    const reading = syncPresentation({ ...base, reason: "session", status: "unauthorized" });
    expect(reading.situation).toBe("expired");
    expect(reading.label).toBe("Sign in");
    expect(reading.sentence).toBe(EXPIRED_SENTENCE);
    expect(reading.action).toBe("signIn");
  });

  it("never blames the reader for a refusal it cannot name", () => {
    const reading = syncPresentation({ ...base, reason: null, status: "unauthorized" });
    expect(reading.situation).toBe("problem");
    expect(reading.sentence).toBe(refusalSentence(null));
    expect(reading.sentence).not.toMatch(/refused this browser/i);
    expect(reading.sentence).toContain("saved here");
  });

  it("names each refusal, and only one of them offers to pay", () => {
    expect(refusalSentence("plan")).toContain("stays on this device");
    expect(refusalSentence("limit")).toContain("another synced workspace");
    expect(refusalSentence("elsewhere")).toContain("belongs to another account");
    expect(refusalSentence("session")).toBe(EXPIRED_SENTENCE);
  });

  it("treats a share link as its own credential, not as a signed-out account", () => {
    const reading = syncPresentation({
      ...base,
      phase: "signed-out",
      role: "viewer",
      status: "connected",
    });
    expect(reading.situation).toBe("synced");
    expect(reading.sentence).toBe("You are viewing this workspace.");
  });

  it("names the connection in one word each", () => {
    const label = (status: Parameters<typeof syncPresentation>[0]["status"]) =>
      syncPresentation({ ...base, status }).label;
    expect(label("connected")).toBe("Synced");
    expect(label("connecting")).toBe("Syncing");
    expect(label("rejoining")).toBe("Syncing");
    expect(label("disconnected")).toBe("Offline");
  });

  it("offers a retry only when the connection dropped", () => {
    expect(syncPresentation({ ...base, status: "disconnected" }).action).toBe("retry");
    expect(syncPresentation({ ...base, status: "connected" }).action).toBeNull();
    expect(syncPresentation({ ...base, status: "connecting" }).action).toBeNull();
  });

  it("counts the room including the reader", () => {
    expect(syncPresentation({ ...base, status: "connected" }).sentence).toBe(
      "Synced to your account.",
    );
    expect(syncPresentation({ ...base, status: "connected", peerCount: 2 }).sentence).toBe(
      "3 here, including you.",
    );
  });

  it("says what a dropped connection means for the work", () => {
    const reading = syncPresentation({ ...base, status: "disconnected" });
    expect(reading.sentence).toBe(OFFLINE_SENTENCE);
    expect(reading.sentence).toContain("sync when you are back");
  });
});
