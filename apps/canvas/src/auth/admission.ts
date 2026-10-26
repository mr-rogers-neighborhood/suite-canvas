/**
 * The admission state, in the server's own words
 * ([ADR-0067](../../../docs/decisions/0067-the-account-is-the-identity.md) §7).
 *
 * Admission is a licensing gate, not an authentication one: it refuses exactly
 * three things — creating an organization, claiming a workspace, opening a sync
 * connection — and never refuses editing, importing or exporting. This file holds
 * the sentence a held account is shown, copied from
 * `services/auth/src/admission.ts` because the client cannot import the server.
 * `admission.test.ts` binds the two together so they cannot drift: if the server
 * changes its words, the client's test fails rather than quietly disagreeing.
 */

/** The one sentence a held account is shown, wherever it is held. */
export const ADMISSION_PENDING_MESSAGE =
  "You're on the list. We'll email you when your workspace is ready.";

/** The refusal code, so the client can tell "held" from "forbidden". */
export const ADMISSION_PENDING_CODE = "admission-pending";
