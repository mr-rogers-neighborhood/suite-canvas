import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Stripe webhook plumbing without the Stripe SDK: signature verification, a
 * minimal event envelope, and readers for the two events this service acts on.
 *
 * Signatures follow Stripe's scheme: the sent header carries a Unix timestamp
 * `t` and one or more HMAC-SHA256 `v1` signatures over the exact bytes
 * `"{t}.{raw body}"`. Verification therefore needs the raw body, before any
 * JSON parsing, and a payload re-serialised from an object will not match.
 */

/** Stripe's own replay window for `t`: five minutes either side of now. */
export const SIGNATURE_TOLERANCE_SECONDS = 5 * 60;

export type SignatureProblem =
  | "no-secret"
  | "missing-header"
  | "malformed-header"
  | "timestamp-out-of-tolerance"
  | "no-matching-signature";

export type SignatureVerification =
  | { ok: true; timestamp: number }
  | { ok: false; reason: SignatureProblem };

export interface SignatureInput {
  /** The body exactly as it arrived; never a re-serialised event. */
  rawBody: string | Buffer;
  header: string | null | undefined;
  secret: string | null | undefined;
  /** Epoch milliseconds, injected so tests can move the clock. */
  now: number;
  toleranceSeconds?: number;
}

/** Constant-time check of a `Stripe-Signature` header. Never logs the secret. */
export function verifyStripeSignature(input: SignatureInput): SignatureVerification {
  const secret = input.secret?.trim();
  if (!secret) return { ok: false, reason: "no-secret" };

  const header = input.header?.trim();
  if (!header) return { ok: false, reason: "missing-header" };

  let timestamp: number | null = null;
  const signatures: Buffer[] = [];
  for (const part of header.split(",")) {
    const separator = part.indexOf("=");
    if (separator <= 0) continue;
    const key = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (key === "t") {
      if (!/^\d+$/.test(value)) return { ok: false, reason: "malformed-header" };
      timestamp = Number(value);
    } else if (key === "v1" && /^[0-9a-f]{64}$/i.test(value)) {
      signatures.push(Buffer.from(value, "hex"));
    }
  }

  if (timestamp === null || signatures.length === 0) {
    return { ok: false, reason: "malformed-header" };
  }

  const nowSeconds = Math.floor(input.now / 1000);
  const tolerance = input.toleranceSeconds ?? SIGNATURE_TOLERANCE_SECONDS;
  if (Math.abs(nowSeconds - timestamp) > tolerance) {
    return { ok: false, reason: "timestamp-out-of-tolerance" };
  }

  const payload =
    typeof input.rawBody === "string" ? input.rawBody : input.rawBody.toString("utf8");
  const expected = createHmac("sha256", secret).update(`${timestamp}.${payload}`, "utf8").digest();

  let matched = false;
  for (const signature of signatures) {
    // timingSafeEqual throws on a length mismatch, so compare only equal halves.
    if (signature.length === expected.length && timingSafeEqual(signature, expected)) {
      matched = true;
    }
  }
  return matched ? { ok: true, timestamp } : { ok: false, reason: "no-matching-signature" };
}

export interface StripeEvent {
  id: string;
  type: string;
  createdAt: number;
  /** `data.object`, left raw; the readers below narrow it per event type. */
  object: unknown;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

/** Parses an event envelope; null means the body is not a Stripe event. */
export function parseStripeEvent(rawBody: string): StripeEvent | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return null;
  }

  const event = asRecord(parsed);
  if (!event) return null;
  const id = text(event.id);
  const type = text(event.type);
  const data = asRecord(event.data);
  if (id === null || type === null || data === null || !("object" in data)) return null;

  return {
    id,
    type,
    createdAt: typeof event.created === "number" ? event.created : 0,
    object: data.object,
  };
}

export interface CheckoutSessionDetails {
  id: string;
  customerId: string;
  email: string | null;
  priceId: string | null;
  subscriptionId: string | null;
  paymentStatus: string | null;
}

/** A customer reference may arrive as an id or, when expanded, an object. */
function customerId(value: unknown): string | null {
  const direct = text(value);
  if (direct !== null) return direct;
  const expanded = asRecord(value);
  return expanded === null ? null : text(expanded.id);
}

/**
 * Checkout Sessions expose `line_items`; Invoices expose `lines`. Both end in
 * `data[].price.id`, so one reader covers both shapes.
 */
function firstLinePriceId(object: Record<string, unknown>): string | null {
  for (const container of [asRecord(object.line_items), asRecord(object.lines)]) {
    const lines = container?.data;
    if (!Array.isArray(lines)) continue;
    for (const line of lines) {
      const price = asRecord(asRecord(line)?.price);
      const id = price === null ? null : text(price.id);
      if (id !== null) return id;
    }
  }
  return null;
}

/**
 * Reads the parts of a completed Checkout Session this service needs.
 *
 * Checkout Sessions do not carry their line items unless the endpoint expands
 * `line_items`, so the price can also be pinned when the session is created:
 * `metadata.price_id`. Both routes lead to the same tier table.
 */
export function readCheckoutSession(object: unknown): CheckoutSessionDetails | null {
  const session = asRecord(object);
  if (session === null) return null;
  const id = text(session.id);
  const customer = customerId(session.customer);
  if (id === null || customer === null) return null;

  const details = asRecord(session.customer_details);
  const metadata = asRecord(session.metadata);
  return {
    id,
    customerId: customer,
    email: text(details?.email) ?? text(session.customer_email) ?? text(metadata?.email),
    priceId: text(metadata?.price_id) ?? firstLinePriceId(session),
    subscriptionId: customerId(session.subscription),
    paymentStatus: text(session.payment_status),
  };
}

export interface InvoiceDetails {
  id: string;
  customerId: string;
  email: string | null;
  priceId: string | null;
  subscriptionId: string | null;
  billingReason: string | null;
  /** First day of the paid period, epoch milliseconds, when Stripe reports one. */
  periodStartMs: number | null;
  /** Last day of the paid period: what a renewal extends the licence to. */
  periodEndMs: number | null;
}

/** Stripe sends seconds; every clock in this service is milliseconds. */
function epochMs(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.round(value * 1000)
    : null;
}

function firstLinePeriod(object: Record<string, unknown>): { start: unknown; end: unknown } {
  const lines = asRecord(object.lines)?.data;
  if (!Array.isArray(lines)) return { start: null, end: null };
  for (const line of lines) {
    const period = asRecord(asRecord(line)?.period);
    if (period !== null) return { start: period.start, end: period.end };
  }
  return { start: null, end: null };
}

/**
 * Reads a paid invoice. `billing_reason` distinguishes the first payment
 * (`subscription_create`, already delivered by the checkout event) from a
 * renewal (`subscription_cycle`) or a plan change (`subscription_update`).
 */
export function readInvoice(object: unknown): InvoiceDetails | null {
  const invoice = asRecord(object);
  if (invoice === null) return null;
  const id = text(invoice.id);
  const customer = customerId(invoice.customer);
  if (id === null || customer === null) return null;

  const line = firstLinePeriod(invoice);
  return {
    id,
    customerId: customer,
    email: text(invoice.customer_email),
    priceId: firstLinePriceId(invoice),
    subscriptionId: customerId(invoice.subscription),
    billingReason: text(invoice.billing_reason),
    periodStartMs: epochMs(invoice.period_start) ?? epochMs(line.start),
    periodEndMs: epochMs(invoice.period_end) ?? epochMs(line.end),
  };
}
