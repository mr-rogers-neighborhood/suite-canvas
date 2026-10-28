import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SignInDialog } from "./SignInDialog";
import type { SignInActions } from "./signIn";

const actions: SignInActions = {
  passkey: async () => ({ ok: true, message: "Signed in with a passkey." }),
  password: async () => ({ ok: true, message: "Signed in." }),
  magicLink: async () => ({ ok: true, message: "Check your inbox." }),
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

/**
 * The doors, in the order a reader meets them.
 *
 * A link needs an address and a passkey needs this device; a password needs the reader to
 * have invented and remembered a secret, so it is one press away instead of being one of
 * four equal buttons. Google is gone: an OAuth client is another thing an operator has to
 * provision before the first sign-in (ADR-0077 amendment).
 */
describe("the ways in", () => {
  const open = (props: Partial<{ mode: "sign-in" | "sign-up" }> = {}) =>
    render(
      <SignInDialog
        availability="available"
        last={null}
        actions={actions}
        initialMode={props.mode ?? "sign-in"}
        onClose={() => {}}
        onSignedIn={() => {}}
      />,
    );

  it("leads with the address and the link", () => {
    open();
    expect(screen.getByTestId("sign-in-email")).toBeInTheDocument();
    expect(screen.getByTestId("sign-in-email-submit")).toHaveTextContent("Email me a sign-in link");
    expect(screen.getByTestId("sign-in-passkey")).toBeInTheDocument();
  });

  it("keeps the password behind a disclosure, and offers the field once it is open", () => {
    open();
    // Nothing to type a password into until the reader says they have one.
    expect(screen.queryByTestId("sign-in-password-value")).toBeNull();
    fireEvent.click(screen.getByTestId("sign-in-password"));
    expect(screen.getByTestId("sign-in-password-value")).toBeInTheDocument();
    expect(screen.getByTestId("sign-in-password-submit")).toBeInTheDocument();
  });

  it("creates an account with a link, with no password at all", async () => {
    const sent = vi.fn(async () => ({ ok: true as const, message: "Check your inbox." }));
    render(
      <SignInDialog
        availability="available"
        last={null}
        actions={{ ...actions, magicLink: sent }}
        initialMode="sign-up"
        onClose={() => {}}
        onSignedIn={() => {}}
      />,
    );

    fireEvent.change(screen.getByTestId("sign-up-email"), {
      target: { value: "reader@example.com" },
    });
    fireEvent.click(screen.getByTestId("sign-up-link-submit"));
    expect(sent).toHaveBeenCalledWith("reader@example.com");
    // The password form was never asked for.
    expect(screen.queryByTestId("sign-up-password")).toBeNull();
  });

  it("offers Google nowhere, because it is not a method this build has", () => {
    open();
    expect(screen.queryByTestId("sign-in-google")).toBeNull();
    expect(screen.queryByText(/Google/u)).toBeNull();
  });
});
