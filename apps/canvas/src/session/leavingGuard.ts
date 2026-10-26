import type { LoroDoc } from "loro-crdt";
import type { StorageLadder, StorageRung } from "./storageLadder";

/**
 * The leave guard (ADR-0025
 * amendment).
 *
 * A reader whose workspace sits on the `banner` rung is one click from leaving the only copy behind —
 * back to the launcher, or out of the tab. The condition is the ladder's own answer, never a second
 * rule: `banner` is exactly "anonymous, and this browser has not promised to keep the copy".
 *
 * The state this module keeps is the *once per session* memory, in memory rather than in storage: a
 * dismissal describes this page's work, and remembering it across a reload would hide the warning
 * from the document that reload produced. It is tied to the document's version instead, so new work
 * asks again.
 */

/** The one rung that means this browser holds the only copy and has not promised to keep it. */
const GUARDED_RUNG: StorageRung = "banner";

/** Whether the ladder says the work is at risk of disappearing with this browser. */
export function leavingAtRisk(ladder: Pick<StorageLadder, "rung">): boolean {
  return ladder.rung === GUARDED_RUNG;
}

export interface LeavingGuard {
  /** Whether this leave must be intercepted: the reader has not been told about this version. */
  readonly intercepts: (version: string) => boolean;
  /** Records that the reader has been told, so later leaves stay quiet until the work changes. */
  readonly dismiss: (version: string) => void;
}

/**
 * One guard per workspace session. Not a store and not persisted: a page load is the session, and a
 * dismissal only covers the work that was on screen when it happened.
 */
export function createLeavingGuard(): LeavingGuard {
  let dismissedAt: string | null = null;
  return {
    intercepts: (version) => version !== dismissedAt,
    dismiss: (version) => {
      dismissedAt = version;
    },
  };
}

/**
 * The whole decision, in one place, so the dialog is shown exactly when the ladder is on `banner` and
 * the reader has not already answered for this version of the document.
 *
 * `applicable` is false for a share projection: that copy is not the only copy of the work, and a
 * share has neither an export nor an account to offer.
 */
export function shouldWarnBeforeLeaving(input: {
  ladder: Pick<StorageLadder, "rung">;
  guard: LeavingGuard;
  version: string;
  applicable?: boolean;
}): boolean {
  if (input.applicable === false) return false;
  return leavingAtRisk(input.ladder) && input.guard.intercepts(input.version);
}

/**
 * A string that changes whenever the document does. The version vector is monotonic per peer, so
 * comparing two of these is enough to tell "the same work" from "work added since the last warning".
 */
export function documentVersion(doc: LoroDoc): string {
  return [...doc.oplogVersion().toJSON()]
    .map(([peer, counter]) => `${String(peer)}:${counter}`)
    .sort()
    .join("|");
}
