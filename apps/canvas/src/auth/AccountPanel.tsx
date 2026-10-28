import { useRef } from "react";
import { createPortal } from "react-dom";
import { useFocusTrap } from "../dialogs/useFocusTrap";
import { useEscapeLayer } from "../shell/escapeLayers";
import { isPlaceholderEmail } from "./accountLabel";
import { DevicesPanel } from "./DevicesPanel";
import { currentEntitlement } from "./entitlement";
import { MembersPanel } from "./MembersPanel";
import { PlanPanel } from "./PlanPanel";
import { type AccountTab, useAccountStore } from "./useAccountStore";

/**
 * The account surface: who you are, who else is here, which devices are signed
 * in, and what the plan allows.
 *
 * One dialog with four panels rather than four dialogs, because they answer one
 * question — "what is my account" — and a person should be able to look at two of
 * them without reopening. The tab is store state, so the title bar and an upgrade
 * prompt can both open the same panel on the surface they mean.
 */

const TABS: readonly { id: AccountTab; label: string }[] = [
  { id: "account", label: "Account" },
  { id: "members", label: "Members" },
  { id: "devices", label: "Devices" },
  { id: "plan", label: "Plan" },
];

export function AccountPanel() {
  const open = useAccountStore((state) => state.panelOpen);
  const tab = useAccountStore((state) => state.panelTab);
  const account = useAccountStore((state) => state.account);
  const close = useAccountStore((state) => state.closePanel);
  const setTab = useAccountStore((state) => state.setPanelTab);
  const panel = useRef<HTMLDivElement | null>(null);
  useEscapeLayer(close, open);
  useFocusTrap(panel);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[69] flex items-center justify-center">
      <button
        type="button"
        aria-label="Close account"
        className="absolute inset-0 cursor-default border-0 bg-black/25 backdrop-blur-[2px]"
        onClick={close}
      />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label="Account"
        tabIndex={-1}
        data-testid="account-panel"
        data-tab={tab}
        className="relative flex max-h-[min(560px,calc(100vh-3rem))] w-[min(520px,calc(100vw-2rem))] flex-col overflow-hidden rounded-xl border border-[var(--hairline)] bg-[var(--surface)] shadow-xl"
      >
        <nav className="flex items-center gap-1 border-b border-[var(--hairline)] px-3 pt-3">
          {TABS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              data-testid={`account-tab-${entry.id}`}
              aria-current={tab === entry.id ? "page" : undefined}
              onClick={() => setTab(entry.id)}
              className={`rounded-t-md px-2.5 py-1.5 text-[12px] ${
                tab === entry.id
                  ? "border-b-2 border-[var(--ink)] font-medium text-[var(--ink)]"
                  : "text-[var(--ink-muted)] hover:text-[var(--ink)]"
              }`}
            >
              {entry.label}
            </button>
          ))}
          <button
            type="button"
            data-testid="account-panel-close"
            onClick={close}
            className="ml-auto mb-1 rounded px-2 py-1 text-[11px] text-[var(--ink-muted)] hover:bg-black/5 dark:hover:bg-white/10"
          >
            Close
          </button>
        </nav>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          {tab === "account" ? (
            <div data-testid="account-section" className="text-[12px]">
              <h3 className="text-[13px] font-semibold">Account</h3>
              <p data-testid="account-email" className="mt-1 leading-5">
                {
                  /* The panel's job is the address itself, so it shows the address — but a generated
                placeholder is not one, and printing it would be the same bug the app bar had. */
                  account?.email && !isPlaceholderEmail(account.email)
                    ? account.email
                    : "No address on this session."
                }
              </p>
              {account?.name ? (
                <p className="text-[11px] text-[var(--ink-muted)]">{account.name}</p>
              ) : null}
              <p className="mt-2 text-[11px] leading-5 text-[var(--ink-muted)]">
                Signing out leaves every workspace in this browser exactly as it is. Sign back in to
                sync again.
              </p>
            </div>
          ) : null}
          {tab === "members" ? <MembersPanel /> : null}
          {tab === "devices" ? <DevicesPanel /> : null}
          {tab === "plan" ? <PlanPanel entitlement={currentEntitlement()} /> : null}
        </div>
      </div>
    </div>,
    document.body,
  );
}
