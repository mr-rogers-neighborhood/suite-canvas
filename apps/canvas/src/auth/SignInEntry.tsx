import { awaitingAdmission, useAccountStore } from "./useAccountStore";

/**
 * The header's account slot: "Sign in" before there is an account, the account's
 * label after, and a "Waiting for admission" chip while the account is held.
 *
 * It is a plain button rather than a menu for a reason — the whole account
 * surface is one dialog and one panel, and a menu with two items in it would only
 * hide them. It is mounted next to Share/File, which is where someone looks for
 * "my stuff".
 */
export interface SignInEntryProps {
  /**
   * Ends the session. Defaults to loading the client on demand: the header must
   * not pull the Better Auth client into the app chunk, and a standalone build
   * never renders this at all.
   */
  onSignOut?: (() => void) | undefined;
}

function signOutLazily(): void {
  void import("./account").then((module) => module.signOutAccount());
}

export function SignInEntry({ onSignOut = signOutLazily }: SignInEntryProps = {}) {
  const phase = useAccountStore((state) => state.phase);
  const account = useAccountStore((state) => state.account);
  const claim = useAccountStore((state) => state.claim);
  const awaiting = awaitingAdmission({ account, claim });
  const openSignIn = useAccountStore((state) => state.openSignIn);
  const openAdmission = useAccountStore((state) => state.openAdmission);

  if (awaiting) {
    return (
      <button
        type="button"
        data-testid="account-waiting"
        title="Your account is on the list. Local editing keeps working."
        onClick={openAdmission}
        className="rounded-md border border-amber-500/50 px-2 py-1 text-[11px] text-amber-700 dark:text-amber-300"
      >
        Waiting for admission
      </button>
    );
  }

  if (account !== null && phase === "signed-in") {
    return (
      <span className="flex items-center gap-1" data-testid="account-chip">
        <span
          className="max-w-[140px] truncate text-[11px] text-[var(--ink-muted)]"
          title={account.email ?? "Account"}
        >
          {account.email ?? "Account"}
        </span>
        <button
          type="button"
          data-testid="account-sign-out"
          onClick={onSignOut}
          className="rounded-md px-1.5 py-1 text-[11px] text-[var(--ink-muted)] hover:bg-black/5 dark:hover:bg-white/10"
        >
          Sign out
        </button>
      </span>
    );
  }

  return (
    <button
      type="button"
      data-testid="sign-in-entry"
      onClick={openSignIn}
      className="rounded-md border border-[var(--hairline)] px-2 py-1 text-[11px] text-[var(--ink)] hover:bg-black/5 dark:hover:bg-white/10"
    >
      Sign in
    </button>
  );
}
