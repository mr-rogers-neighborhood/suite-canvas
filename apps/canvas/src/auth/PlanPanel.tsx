import { useCallback, useEffect, useState } from "react";
import {
  type BillingPlan,
  listPlans,
  openBillingPortal,
  readEntitlement,
  readSubscription,
  type SubscriptionView,
  startCheckout,
} from "./billing";
import { currentEntitlement, type EntitlementView, quotaLines } from "./entitlement";
import { ensureOrganization, ORGANIZATION_NAME } from "./organization";

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
  /** Overrides the entitlement read; tests pass one instead of minting a token. */
  entitlement?: EntitlementView | null;
  onNotice?: (message: string) => void;
}

type Load = "idle" | "loading" | "done" | "failed";

export function PlanPanel({ entitlement, onNotice }: PlanPanelProps) {
  // The token's own claims are the fast answer; the control plane's read is the
  // authoritative one (a cancelled subscription answers `free` there immediately).
  const [view, setView] = useState<EntitlementView | null>(entitlement ?? currentEntitlement());
  const [plans, setPlans] = useState<BillingPlan[]>([]);
  const [subscription, setSubscription] = useState<SubscriptionView | null>(null);
  const [load, setLoad] = useState<Load>("idle");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (entitlement !== undefined) return;
    let live = true;
    setLoad("loading");
    void (async () => {
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
      if (!live) return;
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
      if (listed.ok) setPlans(listed.value);
      if (current.ok) setSubscription(current.value);
      setLoad(listed.ok || current.ok ? "done" : "failed");
    })();
    return () => {
      live = false;
    };
  }, [entitlement]);

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

  const quota = view === null ? [] : view.quota.length > 0 ? view.quota : quotaLines(view.limits);

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
          Nothing is limited on this server. Everything is available to you.
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

      <h4 className="mt-3 text-[11px] font-semibold uppercase tracking-wide text-[var(--ink-muted)]">
        Subscription
      </h4>
      {load === "loading" ? (
        <p className="mt-1 text-[var(--ink-muted)]">Reading the subscription…</p>
      ) : subscription === null ? (
        <p data-testid="plan-no-subscription" className="mt-1 leading-5 text-[var(--ink-muted)]">
          No subscription is attached to this workspace's organization yet.
        </p>
      ) : (
        <p data-testid="plan-subscription" className="mt-1 leading-5">
          {subscription.plan ?? "A plan"} — {subscription.status}
          {subscription.seats === null ? "" : `, ${subscription.seats} seat(s)`}
        </p>
      )}

      {plans.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {plans.map((plan) => (
            <button
              key={plan.name}
              type="button"
              data-testid={`plan-checkout-${plan.name}`}
              disabled={busy !== null}
              onClick={() => void upgrade(plan.name)}
              className="rounded-lg bg-[var(--ink)] px-3 py-1.5 text-[11px] font-medium text-[var(--surface)] disabled:opacity-50"
            >
              {busy === plan.name ? "Opening checkout…" : `Choose ${plan.name}`}
            </button>
          ))}
        </div>
      ) : null}

      <button
        type="button"
        data-testid="plan-portal"
        disabled={busy !== null}
        onClick={() => void portal()}
        className="mt-3 rounded-lg border border-[var(--hairline)] px-3 py-1.5 text-[11px] text-[var(--ink)] disabled:opacity-50"
      >
        {busy === "portal" ? "Opening the portal…" : "Manage billing in Stripe"}
      </button>

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
