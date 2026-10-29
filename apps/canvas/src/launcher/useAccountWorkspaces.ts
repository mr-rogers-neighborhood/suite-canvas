import { useCallback, useEffect, useState } from "react";
import { useAccountStore } from "../auth/useAccountStore";
import { type AccountWorkspaces, readAccountWorkspaces } from "../session/accountWorkspaces";

/**
 * Which of this browser's workspaces the account holds, kept current.
 *
 * The answer decides the "saved on this device only" notice and every row's label, and it
 * changes at moments the launcher does not control: a payment completes in Stripe's tab,
 * and the account panel closes after a checkout or a portal round trip without this page
 * ever re-mounting. One read at mount described the account as it was before any of that,
 * which is how a launcher sat there telling somebody who had just paid that their work was
 * local.
 *
 * So it reads again on the two signals a page gets: coming back to the tab, and the
 * account panel closing. `null` stays `null` when there is no session, which is the
 * ordinary case for a launcher rather than a fault.
 */
export function useAccountWorkspaces(): {
  account: AccountWorkspaces | null;
  refresh: () => void;
} {
  const [account, setAccount] = useState<AccountWorkspaces | null>(null);

  const refresh = useCallback(() => {
    let live = true;
    // `readAccountWorkspaces` answers null in a standalone build without asking.
    void readAccountWorkspaces().then((result) => {
      if (live) setAccount(result);
    });
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => refresh(), [refresh]);

  useEffect(() => {
    // Coming back to this tab is the only notice a launcher gets that something happened
    // elsewhere: Checkout lands in whichever tab opened it.
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [refresh]);

  // Closing the panel is the end of a round trip that began here, and the plan it bought
  // is what decides whether these workspaces can be in the account at all.
  useEffect(() => {
    let wasOpen = useAccountStore.getState().panelOpen;
    return useAccountStore.subscribe((state) => {
      const closed = wasOpen && !state.panelOpen;
      wasOpen = state.panelOpen;
      if (closed) refresh();
    });
  }, [refresh]);

  return { account, refresh };
}
