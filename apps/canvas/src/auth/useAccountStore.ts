import { create } from "zustand";
import type { LinkPrompt } from "./anonymous";
import type { AuthAvailability } from "./availability";

/**
 * The account, as the UI needs it.
 *
 * UI state only: the session lives in a cookie the server owns, and the prompts
 * are this page's memory of one moment. Nothing here is document truth — the
 * document is in Loro, and a signed-out device is not a different document.
 */
export interface AccountSummary {
  userId: string;
  /** Shown in the header chip; never used to identify anything to a server. */
  email: string | null;
  name: string | null;
  /** When an operator admitted this account, or `null` while it may be waiting. */
  admittedAt: number | null;
}

export type AccountPhase = "unknown" | "anonymous" | "signed-in";

/** The four surfaces the account panel opens on. */
export type AccountTab = "account" | "members" | "devices" | "plan";

/** A refusal that the plan can fix, so the UI can offer a checkout. */
export interface UpgradePrompt {
  code: string;
  message: string;
}

export interface AccountState {
  availability: AuthAvailability;
  phase: AccountPhase;
  account: AccountSummary | null;
  /** Whether the sign-in dialog is open, and which form it opens on. */
  dialogOpen: boolean;
  dialogMode: "sign-in" | "sign-up";
  /** Whether the account panel is open, and on which surface. */
  panelOpen: boolean;
  panelTab: AccountTab;
  /** The one prompt after an anonymous device signs up (ADR-0076). */
  linked: LinkPrompt | null;
  /** A refusal that a higher plan would clear; cleared when dismissed. */
  upgrade: UpgradePrompt | null;
  /** Whether the admission panel is on screen: true only on the server's answer. */
  admissionOpen: boolean;
  /** Opens the dialog on sign-in, or on sign-up when asked for it. */
  openSignIn: (mode?: "sign-in" | "sign-up") => void;
  closeSignIn: () => void;
  openPanel: (tab?: AccountTab) => void;
  closePanel: () => void;
  setPanelTab: (tab: AccountTab) => void;
  /** Sets the deployment's answer and the session it implies. */
  applySession: (input: { availability: AuthAvailability; account: AccountSummary | null }) => void;
  noteLinked: (prompt: LinkPrompt | null) => void;
  dismissLinked: () => void;
  noteUpgrade: (prompt: UpgradePrompt) => void;
  dismissUpgrade: () => void;
  openAdmission: () => void;
  closeAdmission: () => void;
  /** Forgets the account after a sign-out; the workspace stays exactly as it is. */
  clear: () => void;
}

const INITIAL = {
  availability: "unknown" as AuthAvailability,
  phase: "unknown" as AccountPhase,
  account: null,
  dialogOpen: false,
  dialogMode: "sign-in" as "sign-in" | "sign-up",
  panelOpen: false,
  panelTab: "account" as AccountTab,
  linked: null,
  upgrade: null,
  admissionOpen: false,
};

export const useAccountStore = create<AccountState>((set) => ({
  ...INITIAL,
  openSignIn: (mode = "sign-in") => set({ dialogOpen: true, dialogMode: mode }),
  closeSignIn: () => set({ dialogOpen: false }),
  openPanel: (tab = "account") => set({ panelOpen: true, panelTab: tab }),
  closePanel: () => set({ panelOpen: false }),
  setPanelTab: (tab) => set({ panelTab: tab }),
  applySession: ({ availability, account }) =>
    set({
      availability,
      account,
      phase: account === null ? "anonymous" : "signed-in",
      admissionOpen: false,
    }),
  noteLinked: (prompt) => set({ linked: prompt }),
  dismissLinked: () => set({ linked: null }),
  noteUpgrade: (prompt) => set({ upgrade: prompt }),
  dismissUpgrade: () => set({ upgrade: null }),
  openAdmission: () => set({ admissionOpen: true }),
  closeAdmission: () => set({ admissionOpen: false }),
  clear: () => set({ ...INITIAL, availability: "available" }),
}));

/**
 * Registered but not admitted.
 *
 * `admittedAt === null` alone is not proof: a deployment with the operator switch
 * off admits everyone and leaves the field null. What a person sees is therefore
 * always the server's verdict — the panel opens because an organization or a
 * claim was refused with `admission-pending`, never because we guessed.
 */
export function awaitingAdmission(state: Pick<AccountState, "account" | "admissionOpen">): boolean {
  return state.account !== null && state.admissionOpen;
}

/** Whether this device has an account behind it — what the storage ladder reads. */
export function signedIn(state: Pick<AccountState, "phase">): boolean {
  return state.phase === "signed-in";
}

/** Whether a refusal is still waiting for an answer. */
export function upgradeWaiting(state: Pick<AccountState, "upgrade">): boolean {
  return state.upgrade !== null;
}
