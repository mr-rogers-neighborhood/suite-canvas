import { describe, expect, it } from "vitest";
import { storageLadder } from "./storageLadder";

/**
 * The storage ladder (ADR-0067 §6).
 *
 * Two properties matter and neither is cosmetic: the rung decides *whether a reader is interrupted*,
 * so the calm cases must stay calm; and the banner's sentence must be written in words a person uses,
 * so the internal vocabulary is asserted out of it.
 */

const INTERNAL_WORDS = ["evict", "eviction", "quota", "durable", "persist", "best-effort"];

const anonymous = (persist: "unknown" | "persisted" | "denied" | "unsupported", failing = false) =>
  storageLadder({ persist, signedIn: false, synced: false, failing });

describe("the storage ladder", () => {
  it("says nothing to a signed-in reader whose storage is durable", () => {
    const rung = storageLadder({
      persist: "persisted",
      signedIn: true,
      synced: false,
      failing: false,
    });

    // Nothing to say is a real rung: a reader with an account and a durable browser is the normal case.
    expect(rung.rung).toBe("nothing");
    expect(rung.headline).toBeNull();
    expect(rung.alarm).toBe(false);
    expect(rung.action).toBe("none");
  });

  it("keeps a durable browser without an account quiet rather than silent", () => {
    const rung = anonymous("persisted");

    // One calm line, so the pill means something, and no banner asking for anything.
    expect(rung.rung).toBe("quiet");
    expect(rung.pill).toBe("Saved on this device");
    expect(rung.headline).toBe("Saved on this device.");
    expect(rung.action).toBe("none");
  });

  it("tells an anonymous reader where the work is, and names the act that keeps it", () => {
    for (const persist of ["denied", "unsupported", "unknown"] as const) {
      const rung = anonymous(persist);

      expect(rung.rung).toBe("banner");
      expect(rung.action).toBe("sign-in");
      // The pill is a status even here: the work *is* saved on this device, and whether
      // the browser will keep it is a different sentence, in the panel.
      expect(rung.pill).toBe("Saved on this device");
      expect(rung.pill).not.toBe("Saved temporarily");
      expect(rung.alarm).toBe(false);
      // The act, not the threat.
      expect(rung.headline).toBe("Sign in to keep this workspace anywhere.");
      expect(rung.headline).not.toContain("clear your work");
    }
  });

  it("says the same thing about where the work is, durable or not", () => {
    // The pill answers "where", so the browser's answer cannot change it: only a failed
    // write does, and that has its own pill.
    expect(anonymous("persisted").pill).toBe(anonymous("denied").pill);
    expect(anonymous("persisted").pill).toBe("Saved on this device");
  });

  it("keeps quiet about a non-durable browser once the workspace is synced", () => {
    const rung = storageLadder({
      persist: "denied",
      signedIn: true,
      synced: true,
      failing: false,
    });

    // The other copy is the account's, so this is a footnote, not a warning.
    expect(rung.rung).toBe("quiet");
    expect(rung.headline).toContain("synced");
    expect(rung.alarm).toBe(false);
    expect(rung.action).toBe("none");
  });

  /**
   * The panel used to say "your workspace is synced" while signed in and *not*
   * synced — a plan that did not cover it, or a session that ended — and then
   * print the opposite underneath. Signed in without a synced copy is the case
   * where the account is no help at all.
   */
  it("asks for an export when the account has no synced copy yet", () => {
    const rung = storageLadder({
      persist: "denied",
      signedIn: true,
      synced: false,
      failing: false,
    });

    expect(rung.rung).toBe("banner");
    expect(rung.headline).not.toContain("is synced");
    expect(rung.headline).toContain("export");
    expect(rung.action).toBe("export");
  });

  it("stays quiet for an anonymous reader while another device is in the room", () => {
    // The warning is about *this* device being the only copy. With someone else in
    // the room it is not, so asking a collaborating reader to sign in or export is
    // the interruption the author called out (ADR-0025 amendment).
    for (const persist of ["denied", "unsupported", "unknown"] as const) {
      const rung = storageLadder({ persist, signedIn: false, synced: true, failing: false });

      expect(rung.rung).toBe("quiet");
      expect(rung.alarm).toBe(false);
      expect(rung.action).toBe("none");
      expect(rung.pill).toBe("Saved here and synced");
      expect(rung.headline).toContain("Another device");
    }
  });

  it("keeps a durable browser's own answer even while synced", () => {
    // Where the work is does not change because the room is live: only the rung that
    // asks for something does.
    const rung = storageLadder({
      persist: "persisted",
      signedIn: false,
      synced: true,
      failing: false,
    });

    expect(rung.rung).toBe("quiet");
    expect(rung.pill).toBe("Saved on this device");
  });

  it("still blocks a failing write with someone else in the room", () => {
    // A write failing is present tense and local: another copy does not make the
    // reader's next edit land.
    const rung = storageLadder({ persist: "denied", signedIn: false, synced: true, failing: true });

    expect(rung.rung).toBe("blocking");
    expect(rung.alarm).toBe(true);
    expect(rung.action).toBe("export");
  });

  it("treats a failing write as present-tense, whatever the storage answer was", () => {
    const rung = storageLadder({
      persist: "persisted",
      signedIn: true,
      synced: false,
      failing: true,
    });

    // The one blocking case: quota exhausted, so the risk is now.
    expect(rung.rung).toBe("blocking");
    expect(rung.alarm).toBe(true);
    expect(rung.action).toBe("export");
    expect(rung.pill).toBe("Storage full");
  });

  it("never puts our vocabulary in the sentence a reader reads", () => {
    const rungs = [
      anonymous("persisted"),
      anonymous("denied"),
      anonymous("unsupported"),
      storageLadder({ persist: "denied", signedIn: true, synced: false, failing: false }),
      storageLadder({ persist: "persisted", signedIn: true, synced: false, failing: true }),
    ];

    for (const rung of rungs) {
      const spoken = `${rung.pill} ${rung.headline ?? ""}`.toLowerCase();
      for (const word of INTERNAL_WORDS) {
        expect(spoken).not.toContain(word);
      }
    }
  });
});
