import { create } from "zustand";
import type { AuthAvailability } from "./availability";
import { admissionPending, type ClaimReport } from "./claimOnSignIn";

/**
 * The account, as the UI needs it.
 *
 * UI state only: the session lives in a cookie the server owns, and the claim
 * report is this page's memory of one run. Nothing here is document truth — the
 * document is in Loro, and a signed-out device is not a different document.
 */
export interface AccountSummary {
  userId: string;
  /** Shown in the header chip; never used to identify anything to a server. */
  email: string | null;
  /** When an operator admitted this account, or `null` while it may be waiting. */
  admittedAt: number | null;
}

export type AccountPhase = "unknown" | "anonymous" | "signed-in";

export interface AccountState {
  availability: AuthAvailability;
  phase: AccountPhase;
  account: AccountSummary | null;
  /** The last claim-on-sign-in run, so its outcome can be stated once. */
  claim: ClaimReport | null;
  claimRunning: boolean;
  /** Whether the sign-in dialog is open. */
  dialogOpen: boolean;
  /** Whether the admission panel is on screen: true on arrival, and re-openable later. */
  admissionOpen: boolean;
  openSignIn: () => void;
  closeSignIn: () => void;
  /** Sets the deployment's answer and the session it implies. */
  applySession: (input: { availability: AuthAvailability; account: AccountSummary | null }) => void;
  beginClaim: () => void;
  finishClaim: (report: ClaimReport) => void;
  openAdmission: () => void;
  closeAdmission: () => void;
  /** Forgets the account after a sign-out; the workspace stays exactly as it is. */
  clear: () => void;
}

const INITIAL = {
  availability: "unknown" as AuthAvailability,
  phase: "unknown" as AccountPhase,
  account: null,
  claim: null,
  claimRunning: false,
  dialogOpen: false,
  admissionOpen: false,
};

export const useAccountStore = create<AccountState>((set) => ({
  ...INITIAL,
  openSignIn: () => set({ dialogOpen: true }),
  closeSignIn: () => set({ dialogOpen: false }),
  applySession: ({ availability, account }) =>
    set({
      availability,
      account,
      phase: account === null ? "anonymous" : "signed-in",
      // An admitted account has nothing to read; a still-null one may be waiting,
      // and the panel opens when the server confirms it (see `awaitingAdmission`).
      admissionOpen: false,
    }),
  beginClaim: () => set({ claimRunning: true }),
  finishClaim: (report) =>
    set((state) => ({
      claim: report,
      claimRunning: false,
      admissionOpen: admissionPending(report) && state.account?.admittedAt === null,
    })),
  openAdmission: () => set({ admissionOpen: true }),
  closeAdmission: () => set({ admissionOpen: false }),
  clear: () => set({ ...INITIAL, availability: "available" }),
}));

/**
 * Registered but not admitted
 * ([ADR-0067](../../../docs/decisions/0067-the-account-is-the-identity.md) §7).
 *
 * `admittedAt === null` alone is not proof: a deployment with the queue off
 * admits everyone and leaves the field null, so the client asks the server by
 * attempting the first gated thing it needs (an organization, then a claim) and
 * believes only a real `admission-pending` answer. What a person sees is
 * therefore always the server's verdict rather than our guess.
 */
export function awaitingAdmission(state: Pick<AccountState, "account" | "claim">): boolean {
  return (
    state.account !== null && state.account.admittedAt === null && admissionPending(state.claim)
  );
}

/** Whether this device has an account behind it — what the storage ladder reads. */
export function signedIn(state: Pick<AccountState, "phase">): boolean {
  return state.phase === "signed-in";
}
