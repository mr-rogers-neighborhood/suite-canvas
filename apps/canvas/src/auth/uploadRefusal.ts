import { getSession } from "../session/session";
import type { MediaUploadPermission } from "./mediaUploadGating";
import { useAccountStore } from "./useAccountStore";

/** The fact every upload refusal has to carry, whichever surface asks. */
export const UPLOAD_IS_PAID = "File uploads are part of a paid plan.";

/**
 * Where a refused upload sends the reader.
 *
 * Uploaded bytes are the one thing the free tier does not include, and the
 * refusal is only useful if it leads somewhere: an account holder lands on the
 * plan tab of their settings, and a signed-out reader is asked to create the
 * account first — with the sentence that says why, because signing up alone
 * does not buy an upload.
 *
 * Both paths raise the one upgrade prompt, so the reason survives regardless of
 * which dialog the reader is looking at. A share session holds a link token
 * rather than an account, so it takes the signed-out path: prompting for a plan
 * there would offer something that viewer cannot buy.
 */
export function announceUploadRefusal(permission?: MediaUploadPermission): void {
  const store = useAccountStore.getState();
  const reason = permission?.reason ?? UPLOAD_IS_PAID;
  const signedIn = getSession().credential === "account";

  if (signedIn) {
    store.noteUpgrade({ code: "upload-requires-plan", message: reason });
    store.openPanel("plan");
    return;
  }

  store.noteUpgrade({
    code: "upload-requires-account",
    message: `${UPLOAD_IS_PAID} Create an account, then choose a plan that includes uploads.`,
  });
  store.openSignIn("sign-up");
}
