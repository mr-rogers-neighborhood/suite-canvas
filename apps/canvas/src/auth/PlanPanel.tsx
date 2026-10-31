import { useCallback, useEffect, useState } from "react";
import {
  type BillingPlan,
  listPlans,
  openBillingPortal,
  type PlanCatalogue,
  readEntitlement,
  readStorageUsage,
  readSubscription,
  type StorageUsage,
  type SubscriptionView,
  startCheckout,
} from "./billing";
import {
  currentEntitlement,
  type EntitlementView,
  FREE_PLAN_SENTENCE,
  FREE_TIER_ID,
  freeWorkspaceLine,
  quotaLines,
} from "./entitlement";
import { ensureOrganization, ORGANIZATION_NAME } from "./organization";
import { PlanCard, PlanCaveats, SelfHostCard } from "./PlanCards";
import { useAccountStore } from "./useAccountStore";

/**
 * The plan surface: what this account may use, how to buy more, and how to reach
 * Stripe's own portal.
 *
 * Everything shown is the server's answer. The limits come from the control
 * plane's entitlement read, and — before that answer arrives, or on a deployment
 * without it — from the relay's own JWT claims (ADR-0074), which are minted from
 * the same subscription. The plan catalogue and the subscription come from the
 * billing plugin, so a deployment with no Stripe keys simply has nothing to sell
 * here instead of a checkout button that cannot charge.
 *
 * A redirect is the only success shape: Stripe owns the payment page, so this
 * panel hands the browser over rather than pretending to know the outcome.
 */

export interface PlanPanelProps {
  /**
   * The first paint, before the server answers. The host passes the token's own claims so
   * the tier is on screen immediately; it is a seed, not a substitute for the read.
   */
  entitlement?: EntitlementView | null;
  /**
   * Whether to read the catalogue on mount. True everywhere except a test that is not
   * about the read: the host used to pass `entitlement` and the panel took that as "do
   * not ask", so the plan list was never fetched in the app at all.
   */
  readOnMount?: boolean;
  onNotice?: (message: string) => void;
}

type Load = "idle" | "loading" | "done" | "failed";

export function PlanPanel({ entitlement, readOnMount = true, onNotice }: PlanPanelProps) {
  // The token's own claims are the fast answer; the control plane's read is the
  // authoritative one (a cancelled subscription answers `free` there immediately).
  const [view, setView] = useState<EntitlementView | null>(entitlement ?? currentEntitlement());
  const [plans, setPlans] = useState<BillingPlan[]>([]);
  const [mode, setMode] = useState<PlanCatalogue["mode"] | null>(null);
  const [subscription, setSubscription] = useState<SubscriptionView | null>(null);
  const [usage, setUsage] = useState<StorageUsage | null>(null);
  const [load, setLoad] = useState<Load>("idle");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [answered, setAnswered] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const phase = useAccountStore((state) => state.phase);
  // A checkout belongs to an account and an organization, so a reader with no session
  // has nothing to check out with. Offering the button anyway answered 401 and read as a
  // broken plan list; the door they need is the one that makes an account.
  const signedOut = phase === "signed-out";

  /** One read, so the first paint and Retry cannot disagree about what happened. */
  const read = useCallback(async (): Promise<void> => {
    void readStorageUsage().then(setUsage);
    if (signedOut) {
      setAnswered(true);
      setLoad("done");
      return;
    }
    setLoad("loading");
    setNotice(null);
    const organization = await ensureOrganization(ORGANIZATION_NAME);
    const listed = await listPlans();
    const current = organization.ok
      ? await readSubscription(organization.organizationId)
      : ({ ok: true, value: null } as const);
    // The entitlement read, not a second copy of the tier table: whatever it
    // answers is what the relay will enforce on the next mint.
    const entitlementRead = organization.ok
      ? await readEntitlement(organization.organizationId)
      : null;

    if (entitlementRead?.ok) {
      setView({
        tier: entitlementRead.value.tier,
        organizationId: organization.ok ? organization.organizationId : null,
        role: null,
        limits: entitlementRead.value.limits,
        quota: quotaLines(entitlementRead.value.limits),
        refreshesAt: null,
      });
    }
    if (listed.ok) {
      setPlans(listed.value.plans);
      setMode(listed.value.mode);
    }
    if (current.ok) setSubscription(current.value);
    // A refusal is worth a sentence, not an empty page: the account service being down
    // and a deployment that sells nothing look identical once the list is just empty.
    if (!listed.ok) setNotice(listed.message);
    setAnswered(true);
    setLoad(listed.ok || current.ok ? "done" : "failed");
  }, [signedOut]);

  // `answered` is in the guard rather than the dependency list: StrictMode mounts twice,
  // and a second read would spend the organization call for the same answer.
  useEffect(() => {
    if (!readOnMount || signedOut) return;
    void read();
  }, [readOnMount, read, signedOut]);

  const redirect = useCallback((url: string) => {
    // The plan is bought on Stripe's page; the browser has to go there.
    window.location.assign(url);
  }, []);

  const upgrade = useCallback(
    async (plan: string) => {
      setBusy(plan);
      setError(null);
      const result = await startCheckout({ plan, returnUrl: window.location.href });
      setBusy(null);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      redirect(result.value);
    },
    [redirect],
  );

  const portal = useCallback(async () => {
    setBusy("portal");
    setError(null);
    const result = await openBillingPortal({ returnUrl: window.location.href });
    setBusy(null);
    if (!result.ok) {
      setError(result.message);
      onNotice?.(result.message);
      return;
    }
    redirect(result.value);
  }, [onNotice, redirect]);

  // A plan-less organization is `tier: "free"` with no limits at all, so the one number
  // that says what it holds has to come from the tier rather than from a missing entry.
  const unpaid =
    view !== null &&
    (view.tier.trim().toLowerCase() === FREE_TIER_ID ||
      (view.quota.length > 0 && view.quota.every((line) => line.zero)));
  const quota =
    view === null
      ? []
      : Object.keys(view.limits ?? {}).length > 0
        ? quotaLines(view.limits, usage)
        : view.quota.length > 0
          ? view.quota
          : unpaid
            ? [freeWorkspaceLine()]
            : [];

  return (
    <div data-testid="plan-panel" className="text-[12px]">
      <h3 className="text-[13px] font-semibold">Plan</h3>
      <p data-testid="plan-tier" className="mt-1 leading-5">
        {view === null
          ? "Your plan appears once you are signed in."
          : `You are on the ${view.tier} plan${view.role === null ? "" : ` as ${view.role}`}.`}
      </p>

      <h4 className="mt-3 text-[11px] font-semibold uppercase tracking-wide text-[var(--ink-muted)]">
        What you get
      </h4>
      {quota.length === 0 ? (
        <p data-testid="plan-no-limits" className="mt-1 leading-5 text-[var(--ink-muted)]">
          Nothing to show yet.
        </p>
      ) : (
        <dl data-testid="plan-quota" className="mt-1 divide-y divide-[var(--hairline)]">
          {quota.map((line) => (
            <div key={line.id} className="flex items-baseline justify-between py-1">
              <dt className="text-[var(--ink)]">{line.label}</dt>
              <dd className="tabular-nums text-[var(--ink-muted)]">{line.value}</dd>
            </div>
          ))}
        </dl>
      )}
      {unpaid ? (
        <p data-testid="plan-free-sentence" className="mt-1 leading-5 text-[var(--ink-muted)]">
          {FREE_PLAN_SENTENCE}
        </p>
      ) : null}

      <h4 className="mt-3 text-[11px] font-semibold uppercase tracking-wide text-[var(--ink-muted)]">
        Subscription
      </h4>
      {load === "loading" ? (
        <p className="mt-1 text-[var(--ink-muted)]">Reading the subscription…</p>
      ) : subscription === null ? (
        <p data-testid="plan-no-subscription" className="mt-1 leading-5 text-[var(--ink-muted)]">
          You are on the free plan.
        </p>
      ) : (
        <p data-testid="plan-subscription" className="mt-1 leading-5">
          {subscription.plan ?? "A plan"} — {subscription.status}
          {subscription.seats === null
            ? ""
            : `, ${String(subscription.seats)} ${subscription.seats === 1 ? "member" : "members"}`}
        </p>
      )}

      {mode === "test" ? (
        // The one thing a person about to type a card number needs to know: whose cards
        // these are. A test-mode deployment charges nothing, and saying so is cheaper
        // than the support question it prevents.
        <p
          data-testid="plan-test-mode"
          className="mt-3 rounded-lg border border-[var(--hairline)] px-2 py-1.5 text-[11px] text-[var(--ink-muted)]"
        >
          Test mode: pay with a Stripe test card. No money is taken.
        </p>
      ) : null}

      {signedOut ? (
        // A plan is bought by an organization, and an organization belongs to an
        // account, so there is nothing to sell to a visitor with no session. Asking
        // anyway answered "this account could not open a workspace space yet", which
        // reads as a fault rather than as the one missing step.
        <div className="mt-3" data-testid="plan-needs-account">
          <p className="leading-5 text-[var(--ink-muted)]">
            A plan belongs to an account. Make one first, and everything already on this device
            stays here: signing in does not move it.
          </p>
          <button
            type="button"
            data-testid="plan-create-account"
            onClick={() => useAccountStore.getState().openSignIn("sign-up")}
            className="mt-1.5 rounded-lg bg-[var(--ink)] px-3 py-1.5 text-[11px] font-medium text-[var(--surface)]"
          >
            Create an account
          </button>
        </div>
      ) : load === "loading" ? (
        <p className="mt-3 text-[var(--ink-muted)]">Reading the plans…</p>
      ) : plans.length === 0 ? (
        answered && notice !== null ? (
          // The account service not answering and a deployment that sells nothing used to
          // look the same from here: both were an empty space where the plans go.
          <div className="mt-3" data-testid="plan-unavailable">
            <p className="leading-5 text-[var(--ink-muted)]">{notice}</p>
            <button
              type="button"
              data-testid="plan-retry"
              disabled={busy !== null}
              onClick={() => void read()}
              className="mt-1.5 rounded-lg border border-[var(--hairline)] px-3 py-1.5 text-[11px] text-[var(--ink)] disabled:opacity-50"
            >
              Try again
            </button>
          </div>
        ) : answered ? (
          <p data-testid="plan-catalogue-empty" className="mt-3 leading-5 text-[var(--ink-muted)]">
            Plans are not available right now. Try again in a moment.
          </p>
        ) : null
      ) : subscription === null ? (
        // One card per plan, then the door that sells nothing. A price with no allowances is a
        // number asking for trust; the allowances are what the person is actually buying.
        <div className="mt-3 grid gap-2" data-testid="plan-cards">
          {plans.map((plan) => (
            <PlanCard
              key={plan.name}
              plan={plan}
              busy={busy === plan.name}
              onChoose={(name) => void upgrade(name)}
              currentUsage={usage}
            />
          ))}
          <SelfHostCard currentUsage={usage} />
        </div>
      ) : (
        <div className="mt-3">
          <SelfHostCard currentUsage={usage} />
        </div>
      )}

      {signedOut ? null : <PlanCaveats />}

      {subscription === null ? (
        <p data-testid="plan-no-customer" className="mt-3 leading-5 text-[var(--ink-muted)]">
          Choosing a plan opens Stripe's checkout, where the card is entered.
        </p>
      ) : (
        <button
          type="button"
          data-testid="plan-portal"
          disabled={busy !== null}
          onClick={() => void portal()}
          className="mt-3 rounded-lg border border-[var(--hairline)] px-3 py-1.5 text-[11px] text-[var(--ink)] disabled:opacity-50"
        >
          {busy === "portal" ? "Opening the portal…" : "Manage billing in Stripe"}
        </button>
      )}

      {error === null ? null : (
        <p
          role="alert"
          data-testid="plan-error"
          className="mt-2 rounded-lg border border-red-500/40 bg-red-500/10 px-2 py-1.5 text-[11px] text-red-800 dark:text-red-200"
        >
          {error}
        </p>
      )}
    </div>
  );
}
