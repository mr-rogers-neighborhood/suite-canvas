import type { PersistState } from "../storage/durability";

/**
 * What to say about local storage (ADR-0067 §6).
 *
 * The panel used to report the browser's answer in our words — "Best-effort", "Persisted",
 * "durable storage", "eviction" — which is our internal model leaking into a header pill. A reader
 * does not need to know what the Storage API decided; they need to know whether their work is safe and
 * what to do if it is not.
 *
 * Four rungs, in the order a person would care about them:
 *
 * - `blocking` — a write is failing *right now*, so the risk is present tense.
 * - `nothing`  — signed in and persisted: there is genuinely nothing to say.
 * - `quiet`    — persisted without an account: one calm line, no nagging.
 * - `banner`   — no account and no promise of durability: the only rung that asks for something.
 *
 * **The status line is a status, never a warning** (author's note, ADR-0025 amendment). "Saved
 * temporarily" asked a reader to work out whether their work still existed, and answered
 * nothing: the work *is* saved on every edit. So the line says where — "Saved on this device" —
 * and the one thing that is genuinely uncertain, how firmly the browser will keep it, is a
 * sentence with room to explain it and an action to fix it. The single exception is `blocking`,
 * where the risk is present tense and hiding it would be a lie.
 *
 * The line lives inside the sync panel rather than beside it (ADR-0064 amendment): the chrome
 * answers "is anyone else here, and is it going anywhere", and everything about *this* device is
 * one press away under the same control.
 *
 * `signedIn` is a parameter rather than a store read so the ladder is testable before the session
 * exists, and so exactly one place decides what an account changes about the copy.
 */
export type StorageRung = "blocking" | "banner" | "quiet" | "nothing";

export interface StorageLadderInput {
  persist: PersistState;
  /** Whether this device has an account behind it. */
  signedIn: boolean;
  /**
   * Whether the relay holds this workspace right now, so a copy exists that this
   * browser cannot lose. It is what lets the ladder stay quiet while two people are
   * working: a warning about this device's storage is noise when the work is in the
   * room (author's note, ADR-0025 amendment).
   */
  synced: boolean;
  /** Whether a write failed just now (quota exhausted, storage denied). */
  failing: boolean;
}

export interface StorageLadder {
  rung: StorageRung;
  /** What this device can claim about the copy. A line in the status panel, not chrome. */
  pill: string;
  /** Whether the status line should look like a warning. */
  alarm: boolean;
  /** One sentence a person would say, or `null` when there is nothing worth saying. */
  headline: string | null;
  /** The technical detail, for the panel's own body. */
  detail: string;
  /** Whether the banner offers to sign in, or only to export a copy. */
  action: "sign-in" | "export" | "none";
}

/**
 * The panel's body, where there is room to explain. Still plain words: "durable", "evict" and
 * "quota" are our model, not the reader's, and this is the sentence they read when they are
 * already worried about their work.
 */
const DETAIL: Record<PersistState, string> = {
  unknown: "This browser is asked to keep the copy after your first edit.",
  persisted: "This browser has agreed to keep the copy on its own.",
  denied:
    "This browser has not promised to keep the copy, so it may clear it when the device runs low on space. Your work is still saved here, and an account or an exported copy keeps it safe.",
  unsupported:
    "This browser cannot promise to keep the copy. It saves here and keeps working offline, but the browser may clear it without warning.",
};

export function storageLadder(input: StorageLadderInput): StorageLadder {
  const { persist, signedIn, synced, failing } = input;
  const detail = DETAIL[persist];

  if (failing) {
    return {
      rung: "blocking",
      pill: "Storage full",
      alarm: true,
      // The panel's quota message is the specific one; this is the sentence in the chrome.
      headline: "This browser cannot save any more of your work.",
      detail,
      action: "export",
    };
  }

  const durable = persist === "persisted";

  if (signedIn) {
    // An account only makes this copy a footnote *once it is synced*. Signed in
    // and not synced is the one combination where the account is no help at all —
    // a plan that does not cover the workspace, a session that ended — and saying
    // "your workspace is synced" over a copy that is the only one was the panel
    // arguing with itself.
    if (durable) {
      return {
        rung: "nothing",
        pill: "Saved",
        alarm: false,
        headline: null,
        detail,
        action: "none",
      };
    }
    return synced
      ? {
          rung: "quiet",
          pill: "Saved",
          alarm: false,
          headline: "This workspace is synced, so this browser can clear its copy safely.",
          detail,
          action: "none",
        }
      : {
          rung: "banner",
          pill: "Saved on this device",
          alarm: false,
          headline: "This account has no synced copy of this workspace, so export one.",
          detail,
          action: "export",
        };
  }

  return durable
    ? {
        rung: "quiet",
        pill: "Saved on this device",
        alarm: false,
        headline: "Saved on this device.",
        detail,
        action: "none",
      }
    : synced
      ? {
          // Someone else is in the room, so the browser clearing its own copy costs
          // nothing: there is a second one, and asking a collaborating reader to
          // sign in or export while they work is the interruption the author called
          // out. This is the rung the banner gives way to.
          rung: "quiet",
          pill: "Saved here and synced",
          alarm: false,
          headline: "Another device in this room has a copy, so this one can clear its own safely.",
          detail,
          action: "none",
        }
      : {
          rung: "banner",
          // The same pill as the durable case: where the work is does not change because the
          // browser has not promised to keep it, and a different pill here was the hedge.
          pill: "Saved on this device",
          alarm: false,
          // The act, not the threat. What can go wrong is the panel's sentence, where there is
          // room for it and a button beside it.
          headline: "Sign in to keep this workspace anywhere.",
          detail,
          action: "sign-in",
        };
}
