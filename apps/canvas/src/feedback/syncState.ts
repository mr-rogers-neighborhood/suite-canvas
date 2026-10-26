import type { ConnectionStatus } from "../store/useCanvasStore";
import type { SaveState } from "./saveState";

/**
 * What the one status control says, decided without a renderer so each state can
 * be read as a test case.
 *
 * A browser with no session is not a browser whose access was refused. It has no
 * credential to refuse, and nothing was asked of the relay on its behalf, so it
 * reads as local. A refusal while signed in is still a refusal: the relay was
 * reachable and said no.
 */
export type SyncTone = "ok" | "busy" | "muted" | "warn";

/** What the control offers, when it offers anything at all. */
export type SyncAction = "retry" | "signIn" | null;

export interface SyncFacts {
  status: ConnectionStatus;
  /** Whether an account stands behind this browser. */
  signedIn: boolean;
  role?: "editor" | "viewer" | undefined;
  peerCount: number;
  /** Local commits the relay has not seen. */
  pending: number;
}

export interface SyncPresentation {
  /** The two words beside the dot. */
  label: string;
  dot: string;
  /** The room, in one sentence a reader can act on. */
  sentence: string;
  /** The unsent count, or null when there is nothing waiting. */
  pending: string | null;
  tone: SyncTone;
  action: SyncAction;
}

export const SIGN_IN_TO_SYNC =
  "Local only. This workspace lives in this browser and nowhere else. Sign in to sync it with your other devices.";

export const LOCAL_LABEL = "Local";

export const OFFLINE_SENTENCE =
  "Offline. This tab keeps working and saves to this device; a reload needs the network.";

export const REFUSED_SENTENCE =
  "This workspace refused this browser's access, so it cannot sync. Your edits stay on this device. Sign in again, or ask the owner for a seat.";

const DOT: Record<ConnectionStatus, string> = {
  connected: "bg-emerald-500",
  connecting: "bg-amber-400",
  rejoining: "bg-amber-400",
  disconnected: "bg-gray-400 dark:bg-gray-500",
  unauthorized: "bg-red-500",
};

const LABEL: Record<ConnectionStatus, string> = {
  connected: "Synced",
  connecting: "Syncing",
  rejoining: "Syncing",
  disconnected: "Offline",
  unauthorized: "No access",
};

/** `1 unsent change`, or null when the relay has seen everything. */
export function pendingLabel(pending: number): string | null {
  if (pending <= 0) return null;
  return `${pending} unsent ${pending === 1 ? "change" : "changes"}`;
}

/** The room, in one sentence: how many people, and whether it is going anywhere. */
function roomSentence(input: SyncFacts): string {
  switch (input.status) {
    case "disconnected":
      return OFFLINE_SENTENCE;
    case "unauthorized":
      return REFUSED_SENTENCE;
    case "connecting":
      return "Connecting to the relay.";
    case "rejoining":
      return "Back online, catching up with the room.";
    case "connected":
      if (input.role === "viewer") return "You are viewing this workspace.";
      if (input.role === "editor") return "You are editing this workspace.";
      return input.peerCount === 0
        ? "You are the only one here."
        : `${input.peerCount + 1} here, including you.`;
  }
}

export function syncPresentation(input: SyncFacts): SyncPresentation {
  // A share link is not an account, so it has no "signed out" reading: the link
  // is the credential, and a refusal of it is a refusal.
  if (!input.signedIn && input.role === undefined) {
    return {
      label: LOCAL_LABEL,
      dot: DOT.disconnected,
      sentence: SIGN_IN_TO_SYNC,
      pending: null,
      tone: "muted",
      action: "signIn",
    };
  }
  return {
    label: LABEL[input.status],
    dot: DOT[input.status],
    sentence: roomSentence(input),
    pending: pendingLabel(input.pending),
    tone:
      input.status === "unauthorized"
        ? "warn"
        : input.status === "disconnected"
          ? "muted"
          : input.status === "connected"
            ? "ok"
            : "busy",
    action: input.status === "disconnected" ? "retry" : null,
  };
}

export const SAVE_LABEL: Record<SaveState, string> = {
  saved: "Saved on this device",
  saving: "Saving…",
  "not-durable": "Not saved to this device",
};

export const NOT_DURABLE_REASON =
  "This browser cannot keep the workspace, so closing the tab loses anything not exported.";
