import { describe, expect, it } from "vitest";
import { storageLadder } from "./storageLadder";

/**
 * The storage ladder ([ADR-0067](../../../docs/decisions/0067-the-account-is-the-identity.md) §6).
 *
 * Two properties matter and neither is cosmetic: the rung decides *whether a reader is interrupted*,
 * so the calm cases must stay calm; and the banner's sentence must be written in words a person uses,
 * so the internal vocabulary is asserted out of it.
 */

const INTERNAL_WORDS = ["evict", "eviction", "quota", "durable", "persist", "best-effort"];

const anonymous = (persist: "unknown" | "persisted" | "denied" | "unsupported", failing = false) =>
  storageLadder({ persist, signedIn: false, failing });

describe("the storage ladder", () => {
  it("says nothing to a signed-in reader whose storage is durable", () => {
    const rung = storageLadder({ persist: "persisted", signedIn: true, failing: false });

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

  it("asks an anonymous reader to sign in when the browser cannot promise durability", () => {
    for (const persist of ["denied", "unsupported", "unknown"] as const) {
      const rung = anonymous(persist);

      expect(rung.rung).toBe("banner");
      expect(rung.alarm).toBe(true);
      expect(rung.action).toBe("sign-in");
      expect(rung.headline).toBe("This browser may clear your work. Sign in to keep it.");
    }
  });

  it("does not nag a signed-in reader about a non-durable browser", () => {
    const rung = storageLadder({ persist: "denied", signedIn: true, failing: false });

    // The account is the other copy, so this is a footnote, not a warning.
    expect(rung.rung).toBe("quiet");
    expect(rung.alarm).toBe(false);
    expect(rung.action).toBe("none");
  });

  it("treats a failing write as present-tense, whatever the storage answer was", () => {
    const rung = storageLadder({ persist: "persisted", signedIn: true, failing: true });

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
      storageLadder({ persist: "denied", signedIn: true, failing: false }),
      storageLadder({ persist: "persisted", signedIn: true, failing: true }),
    ];

    for (const rung of rungs) {
      const spoken = `${rung.pill} ${rung.headline ?? ""}`.toLowerCase();
      for (const word of INTERNAL_WORDS) {
        expect(spoken).not.toContain(word);
      }
    }
  });
});
