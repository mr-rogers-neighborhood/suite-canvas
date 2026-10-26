import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SignInDialog } from "./SignInDialog";
import type { SignInActions } from "./signIn";

function actions(overrides: Partial<SignInActions> = {}): SignInActions {
  return {
    passkey: async () => ({ ok: true }),
    magicLink: async (email) => ({ ok: true, message: `Check ${email.trim()} for the link.` }),
    google: async () => ({ ok: true, message: "Taking you to Google…" }),
    ...overrides,
  };
}

const noop = () => {};

/** Button labels in the order they render, which is the whole "last used first" rule. */
function submitEmail(value: string): void {
  fireEvent.change(screen.getByTestId("sign-in-email"), { target: { value } });
  fireEvent.submit(screen.getByTestId("sign-in-email").closest("form") as HTMLFormElement);
}

function order(): string[] {
  return screen
    .getAllByRole("button")
    .map((button) => button.textContent ?? "")
    .filter((label) => /passkey|link|Google/i.test(label));
}

describe("sign-in dialog", () => {
  it("leads with the method that worked last, and offers all three", () => {
    render(
      <SignInDialog
        availability="available"
        last="passkey"
        actions={actions()}
        onClose={noop}
        onSignedIn={noop}
      />,
    );

    expect(order()[0]).toBe("Continue with your passkey");
    expect(screen.getByTestId("sign-in-passkey")).toHaveAttribute("data-recent", "true");
    expect(screen.getByTestId("sign-in-magic-link")).toBeInTheDocument();
    expect(screen.getByTestId("sign-in-google")).toBeInTheDocument();
    expect(screen.getByTestId("sign-in-google")).not.toHaveAttribute("data-recent");
  });

  it("offers the same three ways in, without a favourite, on a first visit", () => {
    render(
      <SignInDialog
        availability="available"
        last={null}
        actions={actions()}
        onClose={noop}
        onSignedIn={noop}
      />,
    );
    expect(order()).toEqual(["Use a passkey", "Email me a sign-in link", "Continue with Google"]);
  });

  it("says accounts are unavailable rather than showing buttons that do nothing", () => {
    render(
      <SignInDialog
        availability="unavailable"
        last={null}
        actions={actions()}
        onClose={noop}
        onSignedIn={noop}
      />,
    );

    expect(screen.getByTestId("auth-unavailable")).toHaveTextContent(
      "Accounts are not available on this deployment",
    );
    expect(screen.getByTestId("auth-unavailable")).toHaveTextContent(
      "editing, import and export keep working without an account",
    );
    expect(screen.queryByTestId("sign-in-passkey")).not.toBeInTheDocument();
    expect(screen.queryByTestId("sign-in-magic-link")).not.toBeInTheDocument();
    expect(screen.queryByTestId("sign-in-google")).not.toBeInTheDocument();
    expect(screen.getByTestId("sign-in-dialog")).toHaveAttribute(
      "data-availability",
      "unavailable",
    );
  });

  it("waits rather than guessing before the deployment answers", () => {
    render(
      <SignInDialog
        availability="unknown"
        last={null}
        actions={actions()}
        onClose={noop}
        onSignedIn={noop}
      />,
    );
    expect(screen.getByTestId("sign-in-checking")).toHaveTextContent("whether it has accounts");
    expect(screen.queryByTestId("sign-in-passkey")).not.toBeInTheDocument();
  });

  it("signs in with a passkey and hands control back", async () => {
    const onSignedIn = vi.fn();
    const onClose = vi.fn();
    const passkey = vi.fn(async () => ({ ok: true }) as const);
    render(
      <SignInDialog
        availability="available"
        last="passkey"
        actions={actions({ passkey })}
        onClose={onClose}
        onSignedIn={onSignedIn}
      />,
    );

    fireEvent.click(screen.getByTestId("sign-in-passkey"));
    await waitFor(() => expect(onSignedIn).toHaveBeenCalledTimes(1));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(passkey).toHaveBeenCalledTimes(1);
  });

  it("shows the passkey's own refusal instead of a generic failure", async () => {
    render(
      <SignInDialog
        availability="available"
        last={null}
        actions={actions({
          passkey: async () => ({
            ok: false,
            failure: "cancelled",
            message: "That passkey prompt was dismissed. Nothing changed here.",
          }),
        })}
        onClose={noop}
        onSignedIn={noop}
      />,
    );

    fireEvent.click(screen.getByTestId("sign-in-passkey"));
    expect(await screen.findByTestId("sign-in-problem")).toHaveTextContent("Nothing changed here");
  });

  it("sends a magic link, validating only what cannot be an address", async () => {
    const magicLink = vi.fn(async (email: string) => ({
      ok: true as const,
      message: `Check ${email} for the link.`,
    }));
    render(
      <SignInDialog
        availability="available"
        last={null}
        actions={actions({ magicLink })}
        onClose={noop}
        onSignedIn={noop}
      />,
    );

    fireEvent.click(screen.getByTestId("sign-in-magic-link"));
    // jsdom does not implement a submit button's activation behaviour, so the
    // form's own submit event is what a click would produce.
    submitEmail("nope");
    expect(screen.getByTestId("sign-in-problem")).toHaveTextContent("does not look like");
    expect(magicLink).not.toHaveBeenCalled();

    submitEmail("reader@example.com");
    expect(await screen.findByTestId("sign-in-notice")).toHaveTextContent(
      "Check reader@example.com for the link.",
    );
    expect(magicLink).toHaveBeenCalledWith("reader@example.com");
  });

  it("says where Google is taking you", async () => {
    render(
      <SignInDialog
        availability="available"
        last="google"
        actions={actions()}
        onClose={noop}
        onSignedIn={noop}
      />,
    );
    fireEvent.click(screen.getByTestId("sign-in-google"));
    expect(await screen.findByTestId("sign-in-notice")).toHaveTextContent("Taking you to Google");
  });

  it("states that claiming changes nothing about the workspace", () => {
    render(
      <SignInDialog
        availability="available"
        last={null}
        actions={actions()}
        onClose={noop}
        onSignedIn={noop}
      />,
    );
    expect(screen.getByTestId("sign-in-dialog")).toHaveTextContent(
      "Signing in claims the workspaces this device already holds",
    );
  });

  it("closes without changing anything", () => {
    const onClose = vi.fn();
    render(
      <SignInDialog
        availability="available"
        last={null}
        actions={actions()}
        onClose={onClose}
        onSignedIn={noop}
      />,
    );
    fireEvent.click(screen.getByTestId("sign-in-close"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
