import { useEffect, useState } from "react";
import { AccountPanel } from "./AccountPanel";
import { AdmissionPanel } from "./AdmissionPanel";
import { bootstrapAccount, lastUsedMethod, refreshAccount, signOutAccount } from "./account";
import { signInActions } from "./client";
import { LinkNotice } from "./LinkNotice";
import { SignInDialog } from "./SignInDialog";
import type { SignInMethod } from "./signIn";
import { UpgradePrompt } from "./UpgradePrompt";
import { awaitingAdmission, useAccountStore } from "./useAccountStore";

/** The Turnstile site key, when the deployment turned the challenge on (ADR-0077). */
function captchaSiteKey(): string | null {
  const key = import.meta.env.VITE_SUITE_TURNSTILE_SITE_KEY;
  return typeof key === "string" && key.trim().length > 0 ? key.trim() : null;
}

/**
 * Mounts the account surfaces once, beside the shell: the sign-in dialog, the
 * account panel, the admission notice, the one link prompt and the upgrade prompt.
 *
 * This is also where the account is *read*: the probe, the session lookup and the
 * anonymous-session mint run here, once, so `App` can ask "is this device signed
 * in?" without every surface making its own request. A device with no accounts on
 * its deployment makes exactly one request (the probe) and then nothing at all.
 */
export interface SignInDialogHostProps {
  /** Which form the dialog opens on. The launcher offers both. */
  initialMode?: "sign-in" | "sign-up";
}

export function SignInDialogHost({ initialMode = "sign-in" }: SignInDialogHostProps = {}) {
  const dialogOpen = useAccountStore((state) => state.dialogOpen);
  const dialogMode = useAccountStore((state) => state.dialogMode);
  const availability = useAccountStore((state) => state.availability);
  const account = useAccountStore((state) => state.account);
  const admissionOpen = useAccountStore((state) => state.admissionOpen);
  const closeSignIn = useAccountStore((state) => state.closeSignIn);
  const closeAdmission = useAccountStore((state) => state.closeAdmission);

  // Read once per page: the answer cannot change without a reload or a sign-in.
  useEffect(() => {
    void bootstrapAccount();
  }, []);

  // The last-used method is a cookie the server set; read it when the dialog
  // opens so a sign-in from a moment ago is already reflected.
  const [last, setLast] = useState<SignInMethod | null>(null);
  useEffect(() => {
    if (dialogOpen) setLast(lastUsedMethod());
  }, [dialogOpen]);

  return (
    <>
      {dialogOpen ? (
        <SignInDialog
          availability={availability}
          last={last}
          actions={signInActions}
          initialMode={dialogOpen ? dialogMode : initialMode}
          captchaSiteKey={captchaSiteKey()}
          onClose={closeSignIn}
          onSignedIn={() => {
            void refreshAccount();
          }}
        />
      ) : null}
      {admissionOpen && awaitingAdmission({ account, admissionOpen }) ? (
        <AdmissionPanel
          onDismiss={closeAdmission}
          onSignOut={() => {
            closeAdmission();
            void signOutAccount();
          }}
        />
      ) : null}
      <AccountPanel />
      <LinkNotice />
      <UpgradePrompt />
    </>
  );
}
