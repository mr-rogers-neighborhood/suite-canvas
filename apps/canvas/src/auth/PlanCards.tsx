import type { BillingPlan, PlanPrice } from "./billing";
import { selfHostUrl } from "./docsUrl";
import { humanBytes } from "./entitlement";

/**
 * A plan, as something a person can read before pressing a button.
 *
 * The panel used to offer `Choose personal` and nothing else: no amount, no allowances, no
 * statement of what the money is for. That is enough for a reader who already knows the product
 * and useless for everybody else, which is most of the audience for an alpha.
 *
 * Every number here comes from the server. The price is Stripe's answer, the allowances are the
 * tier table's, and a missing price renders no amount rather than a guessed one. Nothing on a
 * card states a limit the relay does not enforce: `Workspaces` is the ceiling the relay refuses
 * above, `Document storage` and `Attachment storage` are the two caps it counts, and `Members` is
 * the seat count the organization's invitations are checked against.
 */

/** What a tier is for, in one sentence. Unknown tiers get a sentence built from their limits. */
const PURPOSE: Readonly<Record<string, string>> = {
  personal:
    "For individuals and small teams: unlimited workspaces, 10 GB media storage, and 3 seats.",
  organization: "For growing teams: unlimited workspaces, 50 GB media storage, and 10 seats.",
};

function purposeOf(plan: BillingPlan): string {
  const known = PURPOSE[plan.name.trim().toLowerCase()];
  if (known !== undefined) return known;
  const workspaces = plan.limits.workspaces;
  return typeof workspaces === "number" && workspaces > 0
    ? `For ${workspaces} synced ${workspaces === 1 ? "workspace" : "workspaces"}.`
    : "A plan for this server.";
}

const CURRENCY_SYMBOL: Readonly<Record<string, string>> = {
  usd: "$",
  eur: "€",
  gbp: "£",
};

/** `$9 / month`, or nothing at all when Stripe did not answer. */
export function priceLine(price: PlanPrice | null): string | null {
  if (price === null) return null;
  const symbol = CURRENCY_SYMBOL[price.currency.toLowerCase()];
  const whole = price.amount / 100;
  // Minor units are exact; two decimals only when they say something.
  const money =
    symbol === undefined
      ? `${whole.toFixed(2)} ${price.currency.toUpperCase()}`
      : `${symbol}${Number.isInteger(whole) ? whole : whole.toFixed(2)}`;
  return price.interval === null ? money : `${money} / ${price.interval}`;
}

interface Allowance {
  id: string;
  label: string;
  value: string;
}

/** The allowances a card lists, in the order a reader asks about them. */
export function allowancesOf(plan: BillingPlan): Allowance[] {
  const rows: Allowance[] = [];
  const workspaces = plan.limits.workspaces;
  if (typeof workspaces === "number") {
    rows.push({
      id: "workspaces",
      label: "Synced workspaces",
      value:
        workspaces >= 2_147_483_647
          ? "Unlimited"
          : workspaces === 0
            ? "none yet"
            : String(workspaces),
    });
  }
  const documentBytes = plan.limits.documentBytes;
  if (typeof documentBytes === "number") {
    rows.push({
      id: "documentBytes",
      label: "Document storage",
      value: documentBytes === 0 ? "none yet" : humanBytes(documentBytes),
    });
  }
  const attachmentBytes = plan.limits.attachmentBytes;
  if (typeof attachmentBytes === "number") {
    rows.push({
      id: "attachmentBytes",
      label: "Attachment storage",
      value: attachmentBytes === 0 ? "none yet" : humanBytes(attachmentBytes),
    });
  }
  const seats = plan.limits.seats;
  if (typeof seats === "number") {
    rows.push({
      id: "seats",
      label: "Members",
      value: seats === 1 ? "just you" : `${String(seats)}, including you`,
    });
  }
  // A member is an account inside the organization and counts against that allowance. A
  // guest opens a share link: no account, no seat, and as many people as the link reaches.
  // The row exists because "Members: 3" alone reads as "only three people may look", and
  // the half of the answer a reader actually wants is that sharing asks for nothing.
  rows.push({
    id: "guests",
    label: "Guests",
    value: "by share link, not counted",
  });
  return rows;
}

export interface PlanCardProps {
  plan: BillingPlan;
  busy: boolean;
  onChoose: (plan: string) => void;
}

export function PlanCard({ plan, busy, onChoose }: PlanCardProps) {
  const price = priceLine(plan.price);
  const allowances = allowancesOf(plan);
  return (
    <div
      data-testid={`plan-card-${plan.name}`}
      className="flex flex-col rounded-xl border border-[var(--hairline)] p-3"
    >
      <div className="flex items-baseline justify-between gap-2">
        <h4 className="text-[12px] font-semibold capitalize text-[var(--ink)]">{plan.name}</h4>
        <span
          data-testid={`plan-price-${plan.name}`}
          className="tabular-nums text-[12px] text-[var(--ink)]"
        >
          {price ?? "Price unavailable"}
        </span>
      </div>
      <p className="mt-1 leading-5 text-[var(--ink-muted)]">{purposeOf(plan)}</p>
      {allowances.length === 0 ? null : (
        <dl className="mt-2 divide-y divide-[var(--hairline)]">
          {allowances.map((row) => (
            <div key={row.id} className="flex items-baseline justify-between py-1">
              <dt className="text-[var(--ink)]">{row.label}</dt>
              <dd
                data-testid={`plan-allowance-${plan.name}-${row.id}`}
                className="tabular-nums text-[var(--ink-muted)]"
              >
                {row.value}
              </dd>
            </div>
          ))}
        </dl>
      )}
      <button
        type="button"
        data-testid={`plan-checkout-${plan.name}`}
        disabled={busy}
        onClick={() => onChoose(plan.name)}
        className="mt-2.5 rounded-lg bg-[var(--ink)] px-3 py-1.5 text-[11px] font-medium text-[var(--surface)] disabled:opacity-50"
      >
        {busy ? "Opening checkout…" : `Choose ${plan.name}`}
      </button>
    </div>
  );
}

/**
 * The third door, which sells nothing.
 *
 * A reader who does not want a subscription has one honest option and the panel should say so
 * rather than pretending the plans are the only way. It is a link, not a button: nothing about it
 * charges anybody, and a self-hosted relay needs no licence and enforces no limit.
 */
export function SelfHostCard() {
  return (
    <div
      data-testid="plan-card-self-host"
      className="flex flex-col rounded-xl border border-dashed border-[var(--hairline)] p-3"
    >
      <h4 className="text-[12px] font-semibold text-[var(--ink)]">Self-host</h4>
      <span className="mt-1 text-[12px] text-[var(--ink)]">Free, forever</span>
      <p className="mt-1 leading-5 text-[var(--ink-muted)]">
        Run it on your own machine or server. No account, no plan and no licence, and the install is
        one file.
      </p>
      <a
        data-testid="plan-self-host-link"
        href={selfHostUrl()}
        target="_blank"
        rel="noreferrer"
        className="mt-2.5 inline-flex items-center gap-1 rounded-lg border border-[var(--hairline)] px-3 py-1.5 text-[11px] font-medium text-[var(--ink)] hover:bg-black/5 dark:hover:bg-white/10"
      >
        Read the guide
      </a>
    </div>
  );
}

/** What a plan buys, what it does not, and how to stop paying. True in every state. */
export function PlanCaveats() {
  return (
    <div
      data-testid="plan-caveats"
      className="mt-3 rounded-xl border border-[var(--hairline)] px-3 py-2 text-[11px] leading-5 text-[var(--ink-muted)]"
    >
      <p>
        <strong className="font-medium text-[var(--ink)]">What a plan buys:</strong> sync,
        collaboration and file uploads. The canvas, the cards and export never ask for one, and
        neither does self-hosting.
      </p>
      <p className="mt-1.5">
        <strong className="font-medium text-[var(--ink)]">And your support.</strong> A subscription
        is what pays for the work while Suite is in alpha. Nothing is behind one, and the code stays
        open source either way.
      </p>
      <p className="mt-1.5">
        <strong className="font-medium text-[var(--ink)]">Members and guests.</strong> A member is
        somebody with their own account in your organization, and a plan says how many can join. A
        guest opens a share link instead: no account, no seat, editor or viewer, and a workspace
        holds up to a hundred of them.
      </p>
      <p className="mt-1.5">
        Billed monthly, cancelled from the portal. Cancelling keeps the plan until the end of the
        month you paid for; after that the organization returns to the free tier and everyone keeps
        what is already on their own device.
      </p>
    </div>
  );
}
