import { useEffect, useState } from "react";
import { AdmissionPanel } from "./AdmissionPanel";
import { bootstrapAccount, lastUsedMethod, refreshAccount, signOutAccount } from "./account";
import { signInActions } from "./client";
import { SignInDialog } from "./SignInDialog";
import type { SignInMethod } from "./signIn";
import { awaitingAdmission, useAccountStore } from "./useAccountStore";

/**
 * Mounts the account surfaces once, beside the shell: the sign-in dialog, and the
 * admission panel when the server says the account is on the list.
 *
 * This is also where the account is *read*: the probe and the session lookup run
 * here, once, so `App` can ask "is this device signed in?" without every surface
 * making its own request. A device with no account makes exactly one request
 * (the probe) and then nothing at all.
 */
export function SignInDialogHost() {
  const dialogOpen = useAccountStore((state) => state.dialogOpen);
  const availability = useAccountStore((state) => state.availability);
  const account = useAccountStore((state) => state.account);
  const claim = useAccountStore((state) => state.claim);
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

  const awaiting = awaitingAdmission({ account, claim });

  return (
    <>
      {dialogOpen ? (
        <SignInDialog
          availability={availability}
          last={last}
          actions={signInActions}
          onClose={closeSignIn}
          onSignedIn={() => {
            void refreshAccount();
          }}
        />
      ) : null}
      {admissionOpen && awaiting ? (
        <AdmissionPanel
          onDismiss={closeAdmission}
          onSignOut={() => {
            closeAdmission();
            void signOutAccount();
          }}
        />
      ) : null}
    </>
  );
}
