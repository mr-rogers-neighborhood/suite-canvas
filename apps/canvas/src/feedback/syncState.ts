import type { ConnectionStatus } from "../store/useCanvasStore";
import type { SaveState } from "./saveState";

/**
 * What the one status control says, decided without a renderer so every state can
 * be read as a test case.
 *
 * Two mistakes this file exists to avoid. First, a browser with no account is not
 * a browser that was refused: nothing was asked of the relay on its behalf, so it
 * reads as saved-and-local, which is the state this product is designed for.
 * Second, a refusal is not one thing. The relay declines for five different
 * reasons and the answer to each is different — sign in, pay, or accept that the
 * workspace belongs to somebody else — so the situation carries the reason rather
 * than collapsing them into one alarming sentence.
 */
export type SyncSituation =
  /** No account, or none this page knows about yet. The work is here and that is fine. */
  | "local"
  /** An account, but this workspace is not in it because the plan does not cover it. */
  | "capped"
  | "synced"
  | "syncing"
  | "offline"
  /** A session that ended, which signing in again fixes. */
  | "expired"
  /** Anything else the relay refused, named by its reason. */
  | "problem";

export type SyncTone = "ok" | "busy" | "muted" | "warn";

/** What the control offers, when it offers anything at all. */
export type SyncAction = "retry" | "signIn" | "seePlans" | null;

/**
 * Why a workspace is not syncing, as far as anyone can tell.
 *
 * `plan` and `limit` are the two a person can act on by paying or by deleting
 * something; `elsewhere` is the one where paying would not help.
 */
export type SyncRefusal = "session" | "plan" | "limit" | "elsewhere" | "unknown";

/** What the account says about this workspace's membership in it. */
export type SyncClaim = "unknown" | "local" | "claimed" | "capped" | "elsewhere";

export interface SyncFacts {
  phase: "unknown" | "signed-out" | "signed-in";
  status: ConnectionStatus;
  /** Whether this page arrived through a share link, which is its own credential. */
  role?: "editor" | "viewer" | undefined;
  peerCount: number;
  claim?: SyncClaim;
  reason?: SyncRefusal | null;
}

export interface SyncPresentation {
  situation: SyncSituation;
  /** The one word beside the dot. */
  label: string;
  dot: string;
  /** One sentence for the panel. Never more than one. */
  sentence: string;
  tone: SyncTone;
  action: SyncAction;
}

export const LOCAL_SENTENCE = "Saved on this device. Sign in to use it on your other devices.";

export const CAPPED_SENTENCE =
  "Saved here. Your plan does not cover this workspace, so it is not syncing.";

export const OFFLINE_SENTENCE = "Offline. Changes save here and sync when you are back.";

export const EXPIRED_SENTENCE = "Your session ended. Sign in to keep syncing this workspace.";

const DOT: Record<SyncSituation, string> = {
  local: "bg-gray-400 dark:bg-gray-500",
  capped: "bg-gray-400 dark:bg-gray-500",
  synced: "bg-emerald-500",
  syncing: "bg-amber-400",
  offline: "bg-gray-400 dark:bg-gray-500",
  expired: "bg-amber-400",
  problem: "bg-amber-400",
};

const LABEL: Record<SyncSituation, string> = {
  local: "Saved",
  capped: "Local",
  synced: "Synced",
  syncing: "Syncing",
  offline: "Offline",
  expired: "Sign in",
  problem: "Needs attention",
};

const ACTION: Record<SyncSituation, SyncAction> = {
  local: "signIn",
  capped: "seePlans",
  synced: null,
  syncing: null,
  offline: "retry",
  expired: "signIn",
  problem: null,
};

/** The one sentence for a refusal, given what the relay said. */
export function refusalSentence(reason: SyncRefusal | null | undefined): string {
  switch (reason) {
    case "plan":
      return "Sync is not active for this account, so this workspace stays on this device.";
    case "limit":
      return "Your plan does not cover another synced workspace, so this one stays on this device.";
    case "elsewhere":
      return "This workspace belongs to another account. It syncs there, not here.";
    case "session":
      return EXPIRED_SENTENCE;
    case "unknown":
    case null:
    case undefined:
      return "This workspace cannot sync right now. Your work is saved here and nothing is lost.";
  }
}

function situationOf(facts: SyncFacts): SyncSituation {
  // A share link is a credential of its own: there is no account to be signed in
  // or out of, and a refusal is the link's, not a session's.
  if (facts.role !== undefined) {
    if (facts.status === "connected") return "synced";
    if (facts.status === "connecting" || facts.status === "rejoining") return "syncing";
    if (facts.status === "disconnected") return "offline";
    return "problem";
  }
  if (facts.phase !== "signed-in") return "local";
  // A live room outranks the claim, and it has to come first.
  //
  // The claim answers "does the account hold this workspace", and the room answers "is
  // this page syncing right now". They disagree in the one case that matters: a member
  // invited into somebody else's organization is in the room with two peers while their
  // own account holds no plan, so the claim comes back `plan-required` and the panel used
  // to read that as Local beside "2 here, including you". Two connected peers is proof,
  // and a badge that argues with its own sentence is worse than either answer.
  switch (facts.status) {
    case "connected":
      return "synced";
    case "connecting":
    case "rejoining":
      return "syncing";
  }
  if (facts.claim === "capped") return "capped";
  if (facts.claim === "elsewhere") return "problem";
  switch (facts.status) {
    case "disconnected":
      return "offline";
    case "unauthorized":
      if (facts.reason === "session") return "expired";
      // The relay's door now answers the same question the claim route does, and it
      // answers it with the plan. A refused room is not a fault to report: the workspace
      // is safe on this device and one button fixes it, which is what `capped` means.
      if (facts.reason === "plan" || facts.reason === "limit") return "capped";
      return "problem";
  }
}

function sentenceOf(facts: SyncFacts, situation: SyncSituation): string {
  switch (situation) {
    case "local":
      return LOCAL_SENTENCE;
    case "capped":
      return CAPPED_SENTENCE;
    case "offline":
      return OFFLINE_SENTENCE;
    case "expired":
      return EXPIRED_SENTENCE;
    case "syncing":
      return "Catching up with the relay.";
    case "problem":
      return refusalSentence(facts.reason);
    case "synced":
      if (facts.role === "viewer") return "You are viewing this workspace.";
      if (facts.role === "editor") return "You are editing this workspace.";
      return facts.peerCount === 0
        ? "Synced to your account."
        : `${facts.peerCount + 1} here, including you.`;
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
      situation === "synced"
        ? "ok"
        : situation === "syncing"
          ? "busy"
          : situation === "local" || situation === "capped" || situation === "offline"
            ? "muted"
            : "warn",
    // A page that has not been told who it is yet offers nothing, so the first
    // paint cannot show a "Sign in" button to someone who already is.
    action: facts.phase === "unknown" && situation === "local" ? null : ACTION[situation],
  };
}

export const SAVE_LABEL: Record<SaveState, string> = {
  saved: "Saved on this device",
  saving: "Saving…",
  "not-durable": "Not saved to this device",
};

export const NOT_DURABLE_REASON =
  "This browser cannot keep the workspace, so closing the tab loses anything not exported.";
