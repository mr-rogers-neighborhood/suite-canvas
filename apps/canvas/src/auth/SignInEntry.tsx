import { useEffect, useRef, useState } from "react";
import { focusFirstMenuItem, menuKeyDown } from "../dialogs/menuKeys";
import { type AccountTab, awaitingAdmission, useAccountStore } from "./useAccountStore";

/** The account surfaces, in the order the menu lists them. */
const MENU: readonly { tab: AccountTab; label: string; id: string }[] = [
  { tab: "account", label: "Account", id: "account" },
  { tab: "members", label: "Members and invitations", id: "members" },
  { tab: "devices", label: "Devices and sessions", id: "devices" },
  { tab: "plan", label: "Plan and usage", id: "plan" },
];

/**
 * The header's account slot: "Sign in" before there is an account, and a menu
 * after.
 *
 * Mounted next to Share and the workspace menu, which is where someone looks for
 * "my stuff". A deployment with no accounts keeps the same entry — clicking it is
 * how a reader learns *why* there is no account here, which is more honest than a
 * control that never appears.
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
  // The literal, not `isStandalone()`: a standalone build never renders this
  // entry, and folding the branch keeps `/api/auth` out of its bundle.
  if (import.meta.env.VITE_SUITE_MODE === "standalone") return;
  void import("./account").then((module) => module.signOutAccount());
}

export function SignInEntry({ onSignOut = signOutLazily }: SignInEntryProps = {}) {
  const phase = useAccountStore((state) => state.phase);
  const account = useAccountStore((state) => state.account);
  const admissionOpen = useAccountStore((state) => state.admissionOpen);
  const openSignIn = useAccountStore((state) => state.openSignIn);
  const openPanel = useAccountStore((state) => state.openPanel);
  const openAdmission = useAccountStore((state) => state.openAdmission);
  const [menuOpen, setMenuOpen] = useState(false);
  const menu = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!menu.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  if (awaitingAdmission({ account, admissionOpen })) {
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
      <span className="relative flex items-center" ref={menu}>
        <button
          type="button"
          data-testid="account-chip"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          title={account.email ?? "Account"}
          onClick={() => setMenuOpen((open) => !open)}
          className="inline-flex h-6 max-w-[180px] items-center gap-1 rounded-md px-2 text-[11px] leading-none text-[var(--ink-muted)] hover:bg-black/5 dark:hover:bg-white/10"
        >
          <span className="min-w-0 truncate">{account.email ?? account.name ?? "Account"}</span>
          <span aria-hidden="true">{"\u25be"}</span>
        </button>
        {menuOpen ? (
          <div
            ref={focusFirstMenuItem}
            role="menu"
            aria-label="Account"
            data-testid="account-menu"
            className="absolute right-0 top-full z-50 mt-1 w-52 overflow-hidden rounded-xl border border-[var(--hairline)] bg-[var(--surface)] p-1 shadow-xl"
            onKeyDown={menuKeyDown}
          >
            {MENU.map((entry) => (
              <button
                key={entry.id}
                type="button"
                role="menuitem"
                data-testid={`account-menu-${entry.id}`}
                className="flex w-full items-center rounded-lg px-2 py-1.5 text-left text-[12px] hover:bg-black/5 dark:hover:bg-white/10"
                onClick={() => {
                  setMenuOpen(false);
                  openPanel(entry.tab);
                }}
              >
                {entry.label}
              </button>
            ))}
            <hr className="my-1 border-[var(--hairline)]" />
            <button
              type="button"
              role="menuitem"
              data-testid="account-sign-out"
              className="flex w-full items-center rounded-lg px-2 py-1.5 text-left text-[12px] text-[var(--ink-muted)] hover:bg-black/5 dark:hover:bg-white/10"
              onClick={() => {
                setMenuOpen(false);
                onSignOut();
              }}
            >
              Sign out
            </button>
          </div>
        ) : null}
      </span>
    );
  }

  return (
    <button
      type="button"
      data-testid="sign-in-entry"
      onClick={() => openSignIn("sign-in")}
      className="rounded-md border border-[var(--hairline)] px-2 py-1 text-[11px] text-[var(--ink)] hover:bg-black/5 dark:hover:bg-white/10"
    >
      Sign in
    </button>
  );
}
