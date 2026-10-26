import type { PersistState } from "../storage/durability";

/**
 * What to say about local storage ([ADR-0067](../../../docs/decisions/0067-the-account-is-the-identity.md) §6).
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
 * `signedIn` is a parameter rather than a store read so the ladder is testable before the session
 * exists, and so exactly one place decides what an account changes about the copy.
 */
export type StorageRung = "blocking" | "banner" | "quiet" | "nothing";

export interface StorageLadderInput {
  persist: PersistState;
  /** Whether this device has an account behind it. */
  signedIn: boolean;
  /** Whether a write failed just now (quota exhausted, storage denied). */
  failing: boolean;
}

export interface StorageLadder {
  rung: StorageRung;
  /** What the header pill reads. Short, because it lives in the chrome. */
  pill: string;
  /** Whether the pill should look like a warning. */
  alarm: boolean;
  /** One sentence a person would say, or `null` when there is nothing worth saying. */
  headline: string | null;
  /** The technical detail, for the panel's own body. */
  detail: string;
  /** Whether the banner offers to sign in, or only to export a copy. */
  action: "sign-in" | "export" | "none";
}

const DETAIL: Record<PersistState, string> = {
  unknown: "This browser is asked for durable storage after your first edit.",
  persisted: "This browser has agreed not to evict this workspace on its own.",
  denied:
    "This browser declined durable storage, so it may clear the local copy when the device runs low on space. The workspace still saves here.",
  unsupported:
    "This browser cannot promise durable storage. The local copy works, but it may be cleared without warning.",
};

export function storageLadder(input: StorageLadderInput): StorageLadder {
  const { persist, signedIn, failing } = input;
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
    // An account means the local copy is not the only copy, so a non-durable browser is a
    // footnote rather than a warning — and a durable one needs no sentence at all.
    return durable
      ? { rung: "nothing", pill: "Saved", alarm: false, headline: null, detail, action: "none" }
      : {
          rung: "quiet",
          pill: "Saved",
          alarm: false,
          headline: "Your workspace is synced, so this browser can clear its copy safely.",
          detail,
          action: "none",
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
    : {
        rung: "banner",
        pill: "Saved temporarily",
        alarm: true,
        // The banner's one sentence: no "eviction", no "quota", no "persist".
        headline: "This browser may clear your work. Sign in to keep it.",
        detail,
        action: "sign-in",
      };
}
