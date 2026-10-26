import assert from "node:assert/strict";
import { createHmac, generateKeyPairSync, verify } from "node:crypto";
import { type BillingStore, type LicenceRecord, memoryStore } from "../store/store.ts";
import type { StripeFetch } from "./client.ts";
import type { Emailer, EmailMessage } from "./email.ts";

/**
 * Shared fixtures for the billing tests. The Ed25519 keypair is generated per
 * process and never written anywhere.
 */

const keys = generateKeyPairSync("ed25519");

export const privatePem = keys.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
export const publicPem = keys.publicKey.export({ type: "spki", format: "pem" }).toString();

/** Not a Stripe secret; the tests HMAC with it directly. */
export const WEBHOOK_SECRET = "whsec_test_5f2f9c1d4a";

export const NOW = 1_800_000_000_000;
export const DAY = 24 * 60 * 60 * 1000;

export const CUSTOMER_ID = "cus_test_1";
export const CUSTOMER_EMAIL = "buyer@example.com";
export const PRICE_SOLO = "price_solo";
export const PRICE_STUDIO = "price_studio";

/** The front-door fixtures: a test-mode key, an app origin, and Stripe's answer. */
export const STRIPE_TEST_KEY = "sk_test_51NtestKeyForFixturesOnly";
export const APP_ORIGIN = "https://canvas.example.com";
/** The billing subject: a subscription belongs to an organization (ADR-0065). */
export const ORGANIZATION_ID = "org_test_1";
/** A workspace, carried only so the browser lands where it was. */
export const WORKSPACE_ID = "ws_test_1";
export const CHECKOUT_URL = "https://checkout.stripe.com/c/pay/cs_test_a1";
export const PORTAL_URL = "https://billing.stripe.com/p/session/test_a1";

export const TIERS_JSON = JSON.stringify({
  [PRICE_SOLO]: {
    tier: "solo",
    workspaces: 3,
    documentBytes: 268_435_456,
    attachmentBytes: 1_073_741_824,
  },
  [PRICE_STUDIO]: {
    tier: "studio",
    workspaces: 25,
    documentBytes: 2_147_483_648,
    attachmentBytes: 8_589_934_592,
  },
});

export function signatureHeader(
  rawBody: string,
  secret = WEBHOOK_SECRET,
  timestamp = Math.floor(NOW / 1000),
): string {
  const signature = createHmac("sha256", secret)
    .update(`${timestamp}.${rawBody}`, "utf8")
    .digest("hex");
  return `t=${timestamp},v1=${signature}`;
}

export function checkoutObject(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "cs_test_1",
    object: "checkout.session",
    customer: CUSTOMER_ID,
    customer_details: { email: CUSTOMER_EMAIL },
    payment_status: "paid",
    subscription: "sub_test_1",
    metadata: { price_id: PRICE_SOLO },
    ...overrides,
  };
}

export function invoiceObject(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "in_test_1",
    object: "invoice",
    customer: CUSTOMER_ID,
    customer_email: CUSTOMER_EMAIL,
    subscription: "sub_test_1",
    billing_reason: "subscription_cycle",
    period_start: Math.floor(NOW / 1000),
    period_end: Math.floor((NOW + 60 * DAY) / 1000),
    lines: { data: [{ price: { id: PRICE_SOLO } }] },
    ...overrides,
  };
}

export function eventBody(
  type: string,
  object: Record<string, unknown>,
  id = "evt_test_1",
): string {
  return JSON.stringify({
    id,
    object: "event",
    type,
    created: Math.floor(NOW / 1000),
    data: { object },
  });
}

/** Decodes a token and fails the test if its Ed25519 signature does not hold. */
export function claimsOf(token: string): Record<string, unknown> {
  const [payload, signature] = token.split(".");
  assert.ok(payload !== undefined && signature !== undefined, "token must have two segments");
  const bytes = Buffer.from(payload, "base64url");
  const good = verify(null, bytes, keys.publicKey, Buffer.from(signature, "base64url"));
  assert.equal(good, true, "the token signature must verify against the test public key");
  return JSON.parse(bytes.toString("utf8")) as Record<string, unknown>;
}

export function recordingEmailer(): { emailer: Emailer; messages: EmailMessage[] } {
  const messages: EmailMessage[] = [];
  return {
    messages,
    emailer: {
      async send(message) {
        messages.push(message);
      },
    },
  };
}

export interface RecordingStore extends BillingStore {
  readonly claims: string[];
  readonly releases: string[];
  readonly puts: LicenceRecord[];
}

/** Delegates to the in-memory store and keeps a trace of what was written. */
export function recordingStore(): RecordingStore {
  const inner = memoryStore();
  const claims: string[] = [];
  const releases: string[] = [];
  const puts: LicenceRecord[] = [];

  return {
    claims,
    releases,
    puts,
    async claimEvent(eventId) {
      claims.push(eventId);
      return inner.claimEvent(eventId);
    },
    async releaseEvent(eventId) {
      releases.push(eventId);
      return inner.releaseEvent(eventId);
    },
    getCustomer(customerId) {
      return inner.getCustomer(customerId);
    },
    async putCustomer(record) {
      puts.push(record);
      await inner.putCustomer(record);
    },
  };
}

export interface RecordedStripeCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string;
  /** The body as Stripe reads it, so a test asserts field names not string order. */
  form: URLSearchParams;
}

export interface FakeStripe {
  fetch: StripeFetch;
  calls: RecordedStripeCall[];
}

/**
 * Stands in for `https://api.stripe.com`. It records the form it was sent and
 * answers what the test asked for, so the front-door tests pin the wire format
 * without a network — which is the point: a wrong field name is the classic bug
 * here and only the encoded body shows it.
 */
export function fakeStripe(options: { status?: number; body?: unknown } = {}): FakeStripe {
  const calls: RecordedStripeCall[] = [];
  const status = options.status ?? 200;
  const payload = options.body === undefined ? { url: CHECKOUT_URL } : options.body;

  return {
    calls,
    async fetch(url, init) {
      calls.push({
        url,
        method: init.method,
        headers: init.headers,
        body: init.body,
        form: new URLSearchParams(init.body),
      });
      const text = typeof payload === "string" ? payload : JSON.stringify(payload);
      return { ok: status >= 200 && status < 300, status, text: async () => text };
    },
  };
}
