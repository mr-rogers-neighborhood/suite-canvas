/**
 * Compatibility entry point for the client's seam test.
 *
 * `apps/canvas/src/auth/admission.test.ts` imports this file by relative path,
 * because the browser cannot depend on the server package and the sentence it
 * renders is a copy that has to be checked against the original. The gate itself
 * lives in `invitations/admission.ts`; this file only keeps that older path
 * pointing at it. New code imports `invitations/`.
 */
export * from "./invitations/admission.js";
