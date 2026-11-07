import type { SaveState } from "./saveState";

/**
 * What the one status control says, decided without a renderer so every state can be read as
 * a test case.
 *
 * The vocabulary is deliberately small, because a person has only four questions about a
 * shared workspace: is my work safe, is anyone else in it, is the other machine answering,
 * and have I been let in yet. Everything the protocol can say collapses into one of those, and
 * the protocol's own words — frame, epoch, key package, relay, host — never appear. They are
 * how it works, not what anyone is being asked to do.
 */
export type SyncState =
  | { readonly state: "off" }
  | { readonly state: "connecting" }
  | { readonly state: "syncing"; readonly count: number }
  | { readonly state: "asleep"; readonly reason: string }
  | { readonly state: "refused"; readonly reason: string }
  /** An invitation has been used, and this device is waiting to be let in. */
  | { readonly state: "waiting" }
  /** Somebody who owns this workspace took this device out of it. */
  | { readonly state: "removed" };

export type SyncSituation =
  /** Nobody else has a copy. The default, and the one this product is designed for. */
  | "local"
  | "connecting"
  | "syncing"
  /** The machine this workspace is shared from is not answering. */
  | "asleep"
  /** An invitation is in use, and the other person has not let this device in yet. */
  | "waiting"
  /** The host said no, or could not be reached for a reason that is not sleep. */
  | "refused"
  /** An owner took this device out. Not a fault, and not something to retry. */
  | "removed";

export type SyncTone = "ok" | "busy" | "muted" | "warn";

export interface SyncPresentation {
  situation: SyncSituation;
  /** The two words beside the dot, at most. */
  label: string;
  dot: string;
  /** One sentence for the panel. Never more than one. */
  sentence: string;
  tone: SyncTone;
}

/** What the control is told. `people` counts this device, so one means "just me". */
export interface SyncFacts {
  readonly state: SyncState | null;
  readonly people: number;
}

const DOT: Record<SyncSituation, string> = {
  local: "bg-gray-400 dark:bg-gray-500",
  connecting: "bg-amber-400",
  syncing: "bg-emerald-500",
  asleep: "bg-amber-400",
  waiting: "bg-amber-400",
  refused: "bg-amber-400",
  removed: "bg-gray-400 dark:bg-gray-500",
};

const LABEL: Record<SyncSituation, string> = {
  local: "Local only",
  connecting: "Connecting",
  syncing: "Syncing",
  asleep: "Host asleep",
  waiting: "Waiting",
  refused: "Not syncing",
  removed: "Removed",
};

/**
 * Why sync stopped, in words that name the next thing a person would do.
 *
 * The host refuses with one of a small set of codes. Those are for us; someone reading this
 * needs to know whether to ask for another invitation, wait, or do nothing because their work
 * is already saved here.
 */
export function refusalSentence(reason: string | null | undefined): string {
  switch (reason) {
    case "invite-expired":
    case "expired":
    case "invite-spent":
    case "unknown-invite":
      return "That invitation cannot be used. Ask for a new one.";
    case "not-authorized":
    case "not-owner":
      return "This device is not allowed to change this workspace.";
    case "stale-epoch":
    case "wrong-seq":
      return "This device is behind the others. It will catch up when it reconnects.";
    case "wrong-workspace":
      return "That invitation is for a different workspace.";
    default:
      return "Sync stopped. This workspace is still saved here.";
  }
}

function situationOf(facts: SyncFacts): SyncSituation {
  switch (facts.state?.state) {
    case "syncing":
      return "syncing";
    case "connecting":
      return "connecting";
    case "waiting":
      return "waiting";
    case "asleep":
      return "asleep";
    case "refused":
      return "refused";
    case "removed":
      return "removed";
    default:
      return "local";
  }
}

function sentenceOf(facts: SyncFacts, situation: SyncSituation): string {
  switch (situation) {
    case "local":
      return "This workspace is on this device. Nobody else has a copy.";
    case "connecting":
      return "Reaching the machine this workspace is shared from.";
    case "waiting":
      return "The invitation is used. The other person has to let this device in.";
    case "asleep":
      return "The machine sharing this workspace is not answering. Changes save here.";
    case "refused":
      return refusalSentence(facts.state?.state === "refused" ? facts.state.reason : null);
    case "removed":
      return "You were removed from this workspace. Your copy is still here.";
    case "syncing": {
      const others = Math.max(0, facts.people - 1);
      if (others === 0) return "Saved here, and to the machine it is shared with.";
      return others === 1
        ? "Saved here, and on one other device."
        : `Saved here, and on ${others} other devices.`;
    }
  }
}

export function syncPresentation(facts: SyncFacts): SyncPresentation {
  const situation = situationOf(facts);
  return {
    situation,
    label: LABEL[situation],
    dot: DOT[situation],
    sentence: sentenceOf(facts, situation),
    tone:
      situation === "syncing"
        ? "ok"
        : situation === "local" || situation === "connecting"
          ? situation === "local"
            ? "muted"
            : "busy"
          : "warn",
  };
}

export const SAVE_LABEL: Record<SaveState, string> = {
  saved: "Saved on this device",
  saving: "Saving…",
  "not-durable": "Not saved to this device",
};

export const NOT_DURABLE_REASON =
  "This browser cannot keep the workspace, so closing the tab loses anything not exported.";
