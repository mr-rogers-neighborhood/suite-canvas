import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SignInEntry } from "./SignInEntry";
import { useAccountStore } from "./useAccountStore";

describe("the header's account slot", () => {
  beforeEach(() => {
    useAccountStore.getState().clear();
    useAccountStore.setState({ availability: "available", phase: "signed-out", account: null });
  });

  it("offers one findable way in before there is an account", () => {
    const onSignOut = vi.fn();
    render(<SignInEntry onSignOut={onSignOut} />);

    fireEvent.click(screen.getByTestId("sign-in-entry"));
    expect(useAccountStore.getState().dialogOpen).toBe(true);
    expect(onSignOut).not.toHaveBeenCalled();
  });

  it("shows the account after signing in, with a way back out", () => {
    useAccountStore.getState().applySession({
      availability: "available",
      account: { userId: "u1", email: "reader@example.com", name: null, admittedAt: 1 },
    });
    const onSignOut = vi.fn();
    render(<SignInEntry onSignOut={onSignOut} />);

    expect(screen.getByTestId("account-chip")).toHaveTextContent("reader@example.com");
    fireEvent.click(screen.getByTestId("account-chip"));
    fireEvent.click(screen.getByTestId("account-sign-out"));
    expect(onSignOut).toHaveBeenCalledTimes(1);
  });

  it("keeps a waiting account reachable after the panel is dismissed", () => {
    useAccountStore.getState().applySession({
      availability: "available",
      account: { userId: "u1", email: null, name: null, admittedAt: null },
    });
    // The server said so by refusing a gated call, which is what opens it.
    useAccountStore.getState().openAdmission();
    useAccountStore.getState().closeAdmission();
    useAccountStore.getState().openAdmission();

    render(<SignInEntry onSignOut={() => {}} />);
    fireEvent.click(screen.getByTestId("account-waiting"));
    expect(useAccountStore.getState().admissionOpen).toBe(true);
  });

  it("opens each account surface from the menu", () => {
    useAccountStore.getState().applySession({
      availability: "available",
      account: { userId: "u1", email: "reader@example.com", name: null, admittedAt: 1 },
    });
    render(<SignInEntry onSignOut={() => {}} />);

    fireEvent.click(screen.getByTestId("account-chip"));
    fireEvent.click(screen.getByTestId("account-menu-plan"));
    expect(useAccountStore.getState().panelOpen).toBe(true);
    expect(useAccountStore.getState().panelTab).toBe("plan");
  });

  it("moves focus into the menu as it opens, so the arrows can arrive", () => {
    useAccountStore.getState().applySession({
      availability: "available",
      account: { userId: "u1", email: "reader@example.com", name: null, admittedAt: 1 },
    });
    render(<SignInEntry onSignOut={() => {}} />);

    fireEvent.click(screen.getByTestId("account-chip"));

    expect(screen.getByTestId("account-menu-account")).toHaveFocus();
    fireEvent.keyDown(screen.getByTestId("account-menu-account"), { key: "End" });
    expect(screen.getByTestId("account-sign-out")).toHaveFocus();
  });

  it("is a plain 'Sign in' on a deployment with no accounts, rather than nothing", () => {
    useAccountStore.setState({ availability: "unavailable", phase: "signed-out", account: null });
    render(<SignInEntry onSignOut={() => {}} />);
    // The entry stays, because clicking it is how someone learns *why* there is
    // no account here — the dialog explains instead of the app staying silent.
    expect(screen.getByTestId("sign-in-entry")).toBeInTheDocument();
  });
});
