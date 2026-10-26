import { AccountEntry } from "./AccountEntry";
import { SignInDialogHost } from "./SignInDialogHost";

/**
 * The account surfaces as one mountable unit: the entry a person presses, and
 * the dialogs it opens.
 *
 * The editor mounts the two separately (the entry belongs in the title bar, the
 * dialogs beside the shell); the launcher has no title bar, so it takes both at
 * once. A deployment with no accounts still gets the entry — pressing it is how
 * someone learns why there is no account here.
 */
export interface AccountSurfaceProps {
  /** Offers "Create account" beside "Sign in", for a first-run screen. */
  showSignUp?: boolean;
}

export function AccountSurface({ showSignUp = false }: AccountSurfaceProps) {
  return (
    <>
      <span className="flex items-center gap-2" data-testid="account-surface">
        {showSignUp ? <AccountEntry mode="sign-up" /> : null}
        <AccountEntry mode="sign-in" />
      </span>
      <SignInDialogHost />
    </>
  );
}
