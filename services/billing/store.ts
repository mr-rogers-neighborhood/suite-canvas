/**
 * The two pieces of state this service needs, behind one interface.
 *
 * `claimEvent` is the idempotency primitive: it returns false the second time
 * an event id is seen, so a repeated Stripe delivery can never mint a second
 * licence. `releaseEvent` exists because a claim must not outlive a failed
 * attempt: when processing throws, the handler returns 500 so Stripe retries,
 * and the retry has to be allowed to try again.
 *
 * `LicenceRecord` is keyed by Stripe customer id. It holds the most recently
 * issued token, which is what makes a re-send possible without re-signing.
 */

export interface LicenceRecord {
  customerId: string;
  email: string;
  tier: string;
  /** The price that selected the tier, so a renewal can stay on the same plan. */
  priceId: string;
  /** Most recently issued token, kept so support can re-send it verbatim. */
  licence: string;
  /** Stable across renewals: relay claims are recorded against this id. */
  licenceId: string;
  issuedAt: number;
  expiresAt: number;
  subscriptionId?: string;
  /** Last paid invoice folded into this record, so two events for one invoice cannot both extend. */
  lastInvoiceId?: string;
  updatedAt: number;
}

export interface BillingStore {
  /** True when this event id has not been processed before; records the claim. */
  claimEvent(eventId: string): Promise<boolean>;
  /** Drops a claim after a failed attempt so the retry is not treated as a duplicate. */
  releaseEvent(eventId: string): Promise<void>;
  getCustomer(customerId: string): Promise<LicenceRecord | null>;
  putCustomer(record: LicenceRecord): Promise<void>;
}

/**
 * Process-local store for tests and the dry-run script.
 *
 * A Lambda container is recycled without warning, so this loses both the event
 * ids and the licences it holds. It is the shape to implement against DynamoDB
 * (or S3) before the hosted endpoint goes live; see docs/billing.md.
 */
export function memoryStore(): BillingStore {
  const events = new Set<string>();
  const customers = new Map<string, LicenceRecord>();

  return {
    async claimEvent(eventId) {
      if (events.has(eventId)) return false;
      events.add(eventId);
      return true;
    },
    async releaseEvent(eventId) {
      events.delete(eventId);
    },
    async getCustomer(customerId) {
      return customers.get(customerId) ?? null;
    },
    async putCustomer(record) {
      customers.set(record.customerId, record);
    },
  };
}
