import { createHash } from "node:crypto";
import { filter, map, pipe } from "remeda";
// The implementation, not the compatibility re-export at
// `apps/collab-server/src/licence.ts`: that shim re-exports `./store/licence.js`,
// and this package runs under `node --test`, whose type stripping resolves the real
// file name instead of mapping `.js` onto `.ts`.
import {
  LICENCE_FORMAT_VERSION,
  type LicenceClaims,
  signLicence,
} from "../../../../apps/collab-server/src/store/licence.ts";
import { BillingError } from "../errors.ts";
import type { BillingStore, LicenceRecord } from "../store/store.ts";
import { type Emailer, renderLicenceEmail } from "./email.ts";
import type { CheckoutSessionDetails, InvoiceDetails } from "./events.ts";
import { DEFAULT_PERIOD_MS, planFor, type TierPlan, type TierTable } from "./tiers.ts";

/**
 * A paid Stripe event, turned into a signed licence.
 *
 * The token format is not defined here: `apps/collab-server/src/licence.ts`
 * owns it, and this module only fills in the payload. That keeps one format,
 * one verifier, and one place to change if the payload ever grows.
 *
 * Two invariants drive the rules below:
 *
 *  1. **Idempotent by outcome.** Re-running an event must not mint a second
 *     token for the same period. Event ids cover retries; `lastInvoiceId` and
 *     the "covers the same period" check cover two different events that
 *     describe one payment.
 *  2. **The email is the only address we have.** There are no accounts, so a
 *     licence with no `email` claim is a licence support cannot trace. A
 *     payment that arrives without one is a failure, not a guess.
 */

/**
 * Two expiries this close describe the same paid period. The first invoice of
 * a subscription lands seconds after `checkout.session.completed`, and both
 * events name the same month; only one of them should mint a token.
 */
const SAME_PERIOD_TOLERANCE_MS = 24 * 60 * 60 * 1000;

/**
 * Opaque, stable licence id for a Stripe customer.
 *
 * Derived rather than random so that a retry, or a lost store entry, still
 * produces the same id: relay claims are recorded against this value, and two
 * ids for one customer would let one subscription claim its workspace quota
 * twice.
 */
export function licenceIdFor(customerId: string): string {
  const digest = createHash("sha256").update(customerId, "utf8").digest("hex").slice(0, 16);
  return `lic-${digest}`;
}

export interface Issuer {
  store: BillingStore;
  tiers: TierTable;
  emailer: Emailer;
  /** Ed25519 private key, PEM. Never logged, never stored next to a token. */
  privateKeyPem: string;
  /** Where the licence email points for the self-hosted path. */
  selfHostUrl: string;
  now: () => number;
  defaultPeriodMs?: number;
}

export type IssueOutcome =
  | { status: "issued"; record: LicenceRecord; token: string }
  | { status: "renewed"; record: LicenceRecord; token: string }
  | { status: "unchanged"; record: LicenceRecord }
  | { status: "ignored"; reason: string };

interface Draft {
  customerId: string;
  email: string;
  plan: TierPlan;
  priceId: string;
  licenceId: string;
  expiresAt: number;
  subscriptionId: string | null;
  lastInvoiceId: string | null;
  previous: LicenceRecord | null;
}

/**
 * Mints the token, emails it, then records it.
 *
 * Email comes before the write on purpose: if SES fails, nothing is recorded,
 * the handler returns 500, and Stripe's retry sends the mail. The reverse order
 * would record an event that can never be re-sent, and the customer would have
 * paid for a licence they never saw.
 */
async function deliver(issuer: Issuer, draft: Draft): Promise<IssueOutcome> {
  const issuedAt = issuer.now();
  const claims: LicenceClaims = {
    v: LICENCE_FORMAT_VERSION,
    id: draft.licenceId,
    tier: draft.plan.tier,
    workspaces: draft.plan.workspaces,
    documentBytes: draft.plan.documentBytes,
    attachmentBytes: draft.plan.attachmentBytes,
    issuedAt,
    expiresAt: draft.expiresAt,
    email: draft.email,
  };
  let token: string;
  try {
    token = signLicence(claims, issuer.privateKeyPem);
  } catch (error) {
    throw new BillingError("signing-failed", `signing failed: ${messageOf(error)}`);
  }

  try {
    await issuer.emailer.send(
      renderLicenceEmail({
        to: draft.email,
        token,
        workspaces: draft.plan.workspaces,
        expiresAt: draft.expiresAt,
        licenceId: draft.licenceId,
        selfHostUrl: issuer.selfHostUrl,
        renewal: draft.previous !== null,
      }),
    );
  } catch (error) {
    throw new BillingError("email-failed", `the email transport failed: ${messageOf(error)}`);
  }

  const record: LicenceRecord = {
    customerId: draft.customerId,
    email: draft.email,
    tier: draft.plan.tier,
    priceId: draft.priceId,
    licence: token,
    licenceId: draft.licenceId,
    issuedAt,
    expiresAt: draft.expiresAt,
    updatedAt: issuedAt,
    ...(draft.subscriptionId === null ? {} : { subscriptionId: draft.subscriptionId }),
    ...(draft.lastInvoiceId === null ? {} : { lastInvoiceId: draft.lastInvoiceId }),
  };
  await issuer.store.putCustomer(record);

  return { status: draft.previous === null ? "issued" : "renewed", record, token };
}

/**
 * True when the new payment describes the period already covered: same plan,
 * same contact, and an expiry within a day of the stored one. Nothing to mint,
 * nothing to email.
 */
function coversSamePeriod(
  previous: LicenceRecord,
  plan: TierPlan,
  priceId: string,
  email: string,
  expiresAt: number,
): boolean {
  return (
    previous.tier === plan.tier &&
    previous.priceId === priceId &&
    previous.email === email &&
    Math.abs(expiresAt - previous.expiresAt) <= SAME_PERIOD_TOLERANCE_MS
  );
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The first candidate that is really an address, preferring the freshest one. */
function emailOf(candidates: readonly (string | null)[]): string | null {
  const present = pipe(
    candidates,
    map((candidate) => candidate?.trim() ?? ""),
    filter((candidate) => candidate.length > 0),
  );
  return present[0] ?? null;
}

/**
 * `checkout.session.completed` — the purchase itself.
 *
 * The session carries no period bounds, so the first payment buys one default
 * period. The subscription's first invoice follows within seconds and corrects
 * that to the real period (an annual plan really does get a year).
 *
 * `lastInvoiceId` is deliberately not written here: recording it would make
 * that first invoice look like a duplicate and leave an annual customer with
 * thirty days.
 */
export async function issueFromCheckout(
  issuer: Issuer,
  session: CheckoutSessionDetails,
): Promise<IssueOutcome> {
  const paymentStatus = session.paymentStatus;
  if (
    paymentStatus !== null &&
    paymentStatus !== "paid" &&
    paymentStatus !== "no_payment_required"
  ) {
    return { status: "ignored", reason: `checkout session ${session.id} is ${paymentStatus}` };
  }

  const now = issuer.now();
  const { plan, priceId } = planFor(issuer.tiers, session.priceId);
  const previous = await issuer.store.getCustomer(session.customerId);
  const email = emailOf([session.email, previous?.email ?? null]);
  if (email === null) {
    throw new BillingError(
      "no-email",
      `checkout session ${session.id} has no customer email, and customer ${session.customerId} has no earlier licence`,
    );
  }

  const period = issuer.defaultPeriodMs ?? DEFAULT_PERIOD_MS;
  const expiresAt = Math.max(previous?.expiresAt ?? 0, now + period);
  if (previous !== null && coversSamePeriod(previous, plan, priceId, email, expiresAt)) {
    return { status: "unchanged", record: previous };
  }

  return deliver(issuer, {
    customerId: session.customerId,
    email,
    plan,
    priceId,
    licenceId: previous?.licenceId ?? licenceIdFor(session.customerId),
    expiresAt,
    subscriptionId: session.subscriptionId,
    lastInvoiceId: null,
    previous,
  });
}

/**
 * `invoice.paid` — a renewal (or a first invoice whose checkout event was
 * missed).
 *
 * The invoice says how long was paid for: the licence runs to the end of that
 * period, never shorter than what the customer already holds. A one-off invoice
 * with no subscription is not a renewal and is ignored.
 */
export async function issueFromInvoice(
  issuer: Issuer,
  invoice: InvoiceDetails,
): Promise<IssueOutcome> {
  if (invoice.subscriptionId === null) {
    return { status: "ignored", reason: `invoice ${invoice.id} is not a subscription invoice` };
  }

  const now = issuer.now();
  const previous = await issuer.store.getCustomer(invoice.customerId);
  if (previous !== null && previous.lastInvoiceId === invoice.id) {
    return { status: "unchanged", record: previous };
  }

  const { plan, priceId } = planFor(issuer.tiers, invoice.priceId ?? previous?.priceId ?? null);
  const email = emailOf([invoice.email, previous?.email ?? null]);
  if (email === null) {
    throw new BillingError(
      "no-email",
      `invoice ${invoice.id} has no customer email, and customer ${invoice.customerId} has no earlier licence`,
    );
  }

  const period = issuer.defaultPeriodMs ?? DEFAULT_PERIOD_MS;
  const paidUntil = invoice.periodEndMs;
  const held = previous?.expiresAt ?? 0;
  const expiresAt =
    paidUntil !== null && paidUntil > now
      ? Math.max(paidUntil, held)
      : Math.max(held, now) + period;

  if (previous !== null && coversSamePeriod(previous, plan, priceId, email, expiresAt)) {
    return { status: "unchanged", record: previous };
  }

  return deliver(issuer, {
    customerId: invoice.customerId,
    email,
    plan,
    priceId,
    licenceId: previous?.licenceId ?? licenceIdFor(invoice.customerId),
    expiresAt,
    subscriptionId: invoice.subscriptionId,
    lastInvoiceId: invoice.id,
    previous,
  });
}

export interface ManualLicenceRequest {
  email: string;
  priceId: string;
  /** Days from now; defaults to one standard period. */
  days?: number;
}

const SIMPLE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * A licence for someone who emailed support (lost key, invoice paid by
 * transfer, comped account). Same signing path, same claims, same email, so a
 * manual grant cannot drift from a purchased one.
 */
export async function issueManual(
  issuer: Issuer,
  request: ManualLicenceRequest,
): Promise<IssueOutcome> {
  const email = request.email.trim();
  if (!SIMPLE_EMAIL.test(email)) {
    throw new BillingError("manual-request", "a valid customer email is required");
  }
  const days =
    request.days ?? Math.round((issuer.defaultPeriodMs ?? DEFAULT_PERIOD_MS) / 86_400_000);
  if (!Number.isSafeInteger(days) || days < 1) {
    throw new BillingError("manual-request", "days must be a whole number of at least 1");
  }

  const now = issuer.now();
  const { plan, priceId } = planFor(issuer.tiers, request.priceId);
  const customerId = `manual:${email.toLowerCase()}`;
  const previous = await issuer.store.getCustomer(customerId);
  const expiresAt = Math.max(previous?.expiresAt ?? 0, now) + days * 24 * 60 * 60 * 1000;

  return deliver(issuer, {
    customerId,
    email,
    plan,
    priceId,
    licenceId: previous?.licenceId ?? licenceIdFor(customerId),
    expiresAt,
    subscriptionId: null,
    lastInvoiceId: null,
    previous,
  });
}
