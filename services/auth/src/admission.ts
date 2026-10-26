/**
 * Admission: registered, but not yet let in
 * ([ADR-0067](../../../docs/decisions/0067-the-account-is-the-identity.md) §7).
 *
 * Better Auth has no such state, and a `pending` role would be worse than a field:
 * the org-wide `owner/admin/member` set is what `capabilitiesForRole` reads, and
 * Better Auth stores roles as one comma-separated string that a bare `setRole`
 * silently rewrites. So admission is a nullable timestamp on the user, and the
 * gate below is the only thing that reads it.
 *
 * What the gate is *for*, stated precisely, because the wrong answer here is a
 * product that punishes curiosity:
 *
 *   refused  creating an organization, claiming a workspace, opening a sync connection
 *   allowed  editing locally, importing a backup, exporting, and signing in at all
 *
 * Local-first is not a privilege we grant. Someone who signed up ten seconds ago and
 * has not been admitted can still write on their own device; what they cannot do is
 * spend our storage or join other people's documents.
 */

/** The one sentence a held account is shown, wherever it is held. */
export const ADMISSION_PENDING_MESSAGE =
  "You're on the list. We'll email you when your workspace is ready.";

/** The refusal code, so a surface can tell "held" from "forbidden". */
export const ADMISSION_PENDING_CODE = "admission-pending";

/** `1` or `true` turns the queue on. Anything else — including unset — is off. */
export function admissionRequired(env: { SUITE_ADMISSION_REQUIRED: string | undefined }): boolean {
  const raw = env.SUITE_ADMISSION_REQUIRED?.trim().toLowerCase();
  return raw === "1" || raw === "true";
}

/**
 * Whether this account has been let in.
 *
 * A deployment with the queue off admits everyone, which is why the environment
 * flag is a parameter and not a stored fact: turning the queue off must not
 * require a data migration, and turning it on must not retroactively lock out
 * accounts that were created while it was off.
 */
export function admitted(
  user: { admittedAt?: number | null } | null | undefined,
  required: boolean,
): boolean {
  if (!required) return true;
  if (user === null || user === undefined) return false;
  const at = user.admittedAt;
  return typeof at === "number" && Number.isFinite(at) && at > 0;
}

/**
 * The paths the gate refuses while an account waits.
 *
 * Deliberately short and literal. Session reads, sign-out, magic-link requests and
 * invitation acceptance are *not* here: a held reader must be able to sign in, look
 * around and leave, and refusing a session read would produce a sign-in loop rather
 * than a message.
 */
export const ADMISSION_GATED_PATHS: readonly string[] = ["/organization/create"];

/** Whether a request path is one the gate should inspect. */
export function isAdmissionGatedPath(path: string): boolean {
  return ADMISSION_GATED_PATHS.some(
    (gated) => path === gated || path.startsWith(`${gated}/`) || path.startsWith(`${gated}?`),
  );
}
