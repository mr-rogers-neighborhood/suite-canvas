import { useAccountStore } from "./useAccountStore";

/**
 * The "Sign in" / "Create account" pair a screen offers before there is an
 * account. It disappears once there is one: the header's account slot takes over
 * from there.
 */
export interface AccountEntryProps {
  mode: "sign-in" | "sign-up";
}

export function AccountEntry({ mode }: AccountEntryProps) {
  const phase = useAccountStore((state) => state.phase);
  const openSignIn = useAccountStore((state) => state.openSignIn);
  if (phase === "signed-in") return null;

  return (
    <button
      type="button"
      data-testid={mode === "sign-up" ? "create-account-entry" : "sign-in-entry-standalone"}
      onClick={() => openSignIn(mode)}
      className={
        mode === "sign-up"
          ? "rounded-md border border-[var(--hairline)] px-2.5 py-1 text-[11px] font-medium text-[var(--ink)] hover:bg-black/5 dark:hover:bg-white/10"
          : "rounded-md border border-[var(--hairline)] px-2.5 py-1 text-[11px] text-[var(--ink-muted)] hover:bg-black/5 dark:hover:bg-white/10"
      }
    >
      {mode === "sign-up" ? "Create account" : "Sign in"}
    </button>
  );
}
