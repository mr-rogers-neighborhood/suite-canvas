import type { IncomingMessage, ServerResponse } from "node:http";
import type { LicenceClaims } from "@suite/licence";
import { HttpError } from "../errors.js";
import { sendJson } from "../respond.js";
import { type AdminRequestDeps, audit, readBody } from "./deps.js";

/**
 * Writing a workspace's licence, so the gate can be tested without Stripe.
 *
 * The relay's quota service reads one row per workspace: the tier, the caps and the expiry
 * a verified session last recorded. That is exactly what a checkout, a webhook and a
 * cancellation would eventually change, so an operator who wants to see what "past due"
 * looks like writes the row rather than waiting on a payment provider. Nothing here
 * invents a state the gate cannot otherwise reach: an expired claim is what a lapsed
 * subscription produces, and an absent one is what a cancelled account produces.
 */
const LICENCE_STATES = ["trial", "active", "past-due", "cancelled"] as const;
type LicenceState = (typeof LICENCE_STATES)[number];

/** A trial that has not run out yet, and a paid seat that has. */
const DAY_MS = 86_400_000;
const EXPIRY_FOR: Record<LicenceState, number> = {
  trial: 14 * DAY_MS,
  active: 30 * DAY_MS,
  // The row is there and the gate refuses it, which is what a past-due subscription is.
  "past-due": -DAY_MS,
  cancelled: -DAY_MS,
};

interface LicenceBody {
  state?: unknown;
  tier?: unknown;
  licenceId?: unknown;
  workspaces?: unknown;
  documentBytes?: unknown;
  attachmentBytes?: unknown;
  expiresAt?: unknown;
}

function count(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : fallback;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

/**
 * Turns a request body into claims.
 *
 * `state` is the product word (trial, active, past due, cancelled) and the numeric fields
 * are the caps a tier would carry. A caller may send either or both; anything left out
 * falls back to what the workspace already has, so "make this past due" does not also
 * reset the caps.
 */
export function licenceClaimsFrom(
  body: LicenceBody,
  options: { workspaceId: string; now: number; existing: LicenceClaims | null },
): LicenceClaims {
  const state = text(body.state) ?? "active";
  if (!LICENCE_STATES.includes(state as LicenceState)) {
    throw HttpError.badRequest(
      `state must be one of ${LICENCE_STATES.join(", ")}, or omitted for an active licence`,
    );
  }
  const expiresAt =
    typeof body.expiresAt === "number" && Number.isFinite(body.expiresAt)
      ? body.expiresAt
      : options.now + EXPIRY_FOR[state as LicenceState];
  return {
    v: 1,
    id: text(body.licenceId) ?? options.existing?.id ?? options.workspaceId,
    tier: text(body.tier) ?? state,
    workspaces: count(body.workspaces, options.existing?.workspaces ?? 1),
    documentBytes: count(body.documentBytes, options.existing?.documentBytes ?? 0),
    attachmentBytes: count(body.attachmentBytes, options.existing?.attachmentBytes ?? 0),
    issuedAt: options.now,
    expiresAt,
  };
}

/** `PUT /api/admin/workspaces/:id/licence` — write the row the gate reads. */
export async function putLicence(
  request: IncomingMessage,
  response: ServerResponse,
  deps: AdminRequestDeps,
  workspaceId: string,
  now = Date.now(),
): Promise<void> {
  const licences = deps.licences;
  if (licences === undefined || licences === null) {
    throw HttpError.notImplemented("This relay was started without a licence store.");
  }
  const body = (await readBody(request)) ?? {};
  // The stored record carries a claim-shaped row, so a second write inherits the caps and
  // the licence id the first one set rather than resetting them.
  const stored = licences.get(workspaceId);
  const claims = licenceClaimsFrom(body, {
    workspaceId,
    now,
    existing: stored
      ? {
          v: 1,
          id: stored.licenceId,
          tier: stored.tier,
          workspaces: stored.quota.workspaces,
          documentBytes: stored.quota.documentBytes,
          attachmentBytes: stored.quota.attachmentBytes,
          issuedAt: stored.claimedAt,
          expiresAt: stored.expiresAt,
        }
      : null,
  });
  const written = licences.record(workspaceId, claims, now);
  audit(deps, {
    path: `/api/admin/workspaces/${workspaceId}/licence`,
    action: "write-licence",
    target: workspaceId,
    outcome: "ok",
    details: { tier: written.tier, expiresAt: written.expiresAt },
  });
  sendJson(response, 200, { licence: written });
}

/** `DELETE /api/admin/workspaces/:id/licence` — clear it, which is what a cancellation does. */
export function deleteLicence(
  response: ServerResponse,
  deps: AdminRequestDeps,
  workspaceId: string,
): void {
  const licences = deps.licences;
  if (licences === undefined || licences === null) {
    throw HttpError.notImplemented("This relay was started without a licence store.");
  }
  const removed = licences.remove(workspaceId);
  audit(deps, {
    path: `/api/admin/workspaces/${workspaceId}/licence`,
    action: "clear-licence",
    target: workspaceId,
    outcome: "ok",
    details: { removed },
  });
  sendJson(response, 200, { removed });
}
