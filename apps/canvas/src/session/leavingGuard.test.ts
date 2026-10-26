import { LoroDoc } from "loro-crdt";
import { describe, expect, it } from "vitest";
import type { PersistState } from "../storage/durability";
import {
  createLeavingGuard,
  documentVersion,
  leavingAtRisk,
  shouldWarnBeforeLeaving,
} from "./leavingGuard";
import { storageLadder } from "./storageLadder";

/**
 * The leave guard ([ADR-0025](../../../docs/decisions/0025-client-durability-and-offline-scope.md)
 * amendment).
 *
 * Two properties carry the feature: the dialog is shown for exactly one rung of the ladder — the
 * anonymous, no-promise one — and it is shown once, until the work changes. Everything else is copy.
 */

const ladderFor = (persist: PersistState, signedIn: boolean, failing = false, synced = false) =>
  storageLadder({ persist, signedIn, synced, failing });

describe("the leave guard", () => {
  // One row per rung a person can actually reach, so an alarm added to the wrong rung
  // fails here instead of in someone's face on the way to the launcher.
  it.each([
    {
      persist: "unknown",
      signedIn: false,
      synced: false,
      failing: false,
      warn: true,
      rung: "banner",
    },
    {
      persist: "denied",
      signedIn: false,
      synced: false,
      failing: false,
      warn: true,
      rung: "banner",
    },
    {
      persist: "unsupported",
      signedIn: false,
      synced: false,
      failing: false,
      warn: true,
      rung: "banner",
    },
    {
      persist: "persisted",
      signedIn: false,
      synced: false,
      failing: false,
      warn: false,
      rung: "quiet",
    },
    // Someone else is in the room, so this browser is not the only copy: the warning,
    // which exists for exactly that case, does not apply.
    {
      persist: "unknown",
      signedIn: false,
      synced: true,
      failing: false,
      warn: false,
      rung: "quiet",
    },
    {
      persist: "denied",
      signedIn: false,
      synced: true,
      failing: false,
      warn: false,
      rung: "quiet",
    },
    {
      persist: "unknown",
      signedIn: true,
      synced: false,
      failing: false,
      warn: false,
      rung: "quiet",
    },
    {
      persist: "denied",
      signedIn: true,
      synced: false,
      failing: false,
      warn: false,
      rung: "quiet",
    },
    {
      persist: "persisted",
      signedIn: true,
      synced: false,
      failing: false,
      warn: false,
      rung: "nothing",
    },
    {
      persist: "unknown",
      signedIn: false,
      synced: false,
      failing: true,
      warn: false,
      rung: "blocking",
    },
    {
      persist: "denied",
      signedIn: false,
      synced: true,
      failing: true,
      warn: false,
      rung: "blocking",
    },
    {
      persist: "persisted",
      signedIn: true,
      synced: false,
      failing: true,
      warn: false,
      rung: "blocking",
    },
  ] as const)(
    "$rung for persist=$persist signedIn=$signedIn synced=$synced failing=$failing",
    ({ persist, signedIn, synced, failing, warn, rung }) => {
      const ladder = ladderFor(persist, signedIn, failing, synced);

      expect(ladder.rung).toBe(rung);
      // The rung is the only input: the guard asks the ladder, and never a second rule.
      expect(leavingAtRisk(ladder)).toBe(rung === "banner");
      expect(shouldWarnBeforeLeaving({ ladder, guard: createLeavingGuard(), version: "v1" })).toBe(
        warn,
      );
    },
  );

  it("asks once, then stays quiet until the work changes", () => {
    const ladder = ladderFor("unknown", false);
    const guard = createLeavingGuard();

    expect(shouldWarnBeforeLeaving({ ladder, guard, version: "v1" })).toBe(true);

    // The reader was told and dismissed: a second return to the launcher is not news.
    guard.dismiss("v1");
    expect(shouldWarnBeforeLeaving({ ladder, guard, version: "v1" })).toBe(false);

    // New work is not covered by the old warning, so the next leave asks again.
    expect(shouldWarnBeforeLeaving({ ladder, guard, version: "v2" })).toBe(true);
  });

  it("never asks for a share projection, even at the banner rung", () => {
    const ladder = ladderFor("denied", false);

    // The projection in this browser is not the only copy of the work, and a share
    // has neither an export nor an account to offer.
    expect(leavingAtRisk(ladder)).toBe(true);
    expect(
      shouldWarnBeforeLeaving({
        ladder,
        guard: createLeavingGuard(),
        version: "v1",
        applicable: false,
      }),
    ).toBe(false);
  });

  it("reads a version that changes only when the document does", () => {
    const doc = new LoroDoc();
    const before = documentVersion(doc);

    expect(documentVersion(doc)).toBe(before);

    doc.getText("body").insert(0, "one more paragraph");
    doc.commit();

    expect(documentVersion(doc)).not.toBe(before);
    // Stable once the work settles: a re-read is what the guard compares against.
    expect(documentVersion(doc)).toBe(documentVersion(doc));
  });
});
