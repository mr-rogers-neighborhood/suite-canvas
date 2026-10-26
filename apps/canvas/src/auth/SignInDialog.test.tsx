import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SignInDialog } from "./SignInDialog";
import type { SignInActions } from "./signIn";

const actions: SignInActions = {
  passkey: async () => ({ ok: true, message: "Signed in with a passkey." }),
  password: async () => ({ ok: true, message: "Signed in." }),
  magicLink: async () => ({ ok: true, message: "Check your inbox." }),
  google: async () => ({ ok: false, message: "Google is not configured." }),
  signUp: async () => ({ ok: true, message: "Account created." }),
};

/**
 * The dialog says `aria-modal="true"`, so Tab must stay inside it and Escape
 * must be the stack's, not a second window listener that fires under other
 * surfaces.
 */
describe("the sign-in dialog", () => {
  it("takes focus when it opens", () => {
    render(
      <SignInDialog
        availability="available"
        last={null}
        actions={actions}
        onClose={() => {}}
        onSignedIn={() => {}}
      />,
    );

    expect(screen.getByTestId("sign-in-dialog").contains(document.activeElement)).toBe(true);
  });

  it("keeps Tab inside the dialog", () => {
    render(
      <SignInDialog
        availability="available"
        last={null}
        actions={actions}
        onClose={() => {}}
        onSignedIn={() => {}}
      />,
    );
    const dialog = screen.getByTestId("sign-in-dialog");
    const last = dialog.querySelectorAll<HTMLElement>(
      "button:not([disabled]), input:not([disabled]), a[href]",
    );
    const tail = last[last.length - 1];
    expect(tail).toBeDefined();

    tail?.focus();
    fireEvent.keyDown(tail as HTMLElement, { key: "Tab" });

    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).not.toBe(tail);
  });

  it("closes on Escape", () => {
    const onClose = vi.fn();
    render(
      <SignInDialog
        availability="available"
        last={null}
        actions={actions}
        onClose={onClose}
        onSignedIn={() => {}}
      />,
    );

    fireEvent.keyDown(screen.getByTestId("sign-in-dialog"), { key: "Escape" });

    expect(onClose).toHaveBeenCalledOnce();
  });
});
