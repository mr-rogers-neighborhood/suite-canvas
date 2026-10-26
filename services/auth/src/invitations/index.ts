/**
 * Invitations: the two doors into an organization — the review queue that decides
 * whether a new account may create one at all (`admission.ts`), and the invitation
 * engine that puts somebody in one (`enrollment.ts`).
 *
 * Both answer with a `Result` at the boundary: the caller receives a named refusal,
 * never a thrown string, and the plugin's own vocabulary is translated here rather
 * than leaking into a route.
 */
export {
  ADMISSION_PENDING_CODE,
  ADMISSION_PENDING_MESSAGE,
  type AdmissionRefusal,
  admissionGate,
  admissionRequired,
  admitted,
  isAdmissionGatedPath,
} from "./admission.js";
export {
  type EnrollmentOutcome,
  type EnrollmentRedeemInput,
  type EnrollmentRedemption,
  enrollmentOptions,
  enrollmentPlugin,
  enrollmentRedemption,
  type InvitationEmail,
  type RedemptionRefusal,
  redemptionResult,
} from "./enrollment.js";
