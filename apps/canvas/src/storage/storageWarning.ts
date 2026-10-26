import { storageLadder } from "../session/storageLadder";
import { type PersistState, type QuotaFailure, useDurabilityStore } from "./durability";

/**
 * Whether this device's copy is at risk, in one place.
 *
 * The sync panel asks this for its warning row and the shell asks it for the one
 * toast a reader gets when the browser refuses to keep the workspace. It answers
 * from `storageLadder()` rather than inventing a second rule, so the row and the
 * toast cannot disagree about when a warning is warranted.
 */

export const STORAGE_AT_RISK_WARNING =
  "This browser has not promised to keep this workspace on this device. Export a copy so a storage cleanup cannot take it.";

export interface StorageWarningState {
  visible: boolean;
  /** The sentence to show, or null when there is nothing to say. */
  message: string | null;
}

export interface StorageWarningInput {
  persist: PersistState;
  quota: QuotaFailure | null;
  /** An account behind this device makes the local copy a footnote, not a risk. */
  signedIn?: boolean;
  /** Another device in the room holds a copy, so this one can be cleared safely. */
  synced?: boolean;
}

/**
 * Whether the shell should show a durability warning. Only the ladder's
 * `banner` and `blocking` rungs ask for something; `quiet` and `nothing` do not,
 * which is what keeps a collaborating reader from being interrupted.
 *
 * `unknown` is silence rather than a warning: the browser has not been asked
 * yet (`persistAfterFirstEdit` asks on the first edit), so there is nothing to
 * report and nothing to export.
 */
export function storageWarningState(input: StorageWarningInput): StorageWarningState {
  const ladder = storageLadder({
    persist: input.persist,
    signedIn: input.signedIn ?? false,
    synced: input.synced ?? false,
    failing: input.quota !== null,
  });
  if (ladder.rung === "blocking") {
    return { visible: true, message: input.quota?.message ?? STORAGE_AT_RISK_WARNING };
  }
  if (ladder.rung === "banner" && input.persist !== "unknown") {
    return { visible: true, message: STORAGE_AT_RISK_WARNING };
  }
  return { visible: false, message: null };
}

/** The live warning state, for a shell that renders its own surface. */
export function useStorageWarning(signedIn = false, synced = false): StorageWarningState {
  const persist = useDurabilityStore((state) => state.persist);
  const quota = useDurabilityStore((state) => state.quota);
  return storageWarningState({ persist, quota, signedIn, synced });
}
