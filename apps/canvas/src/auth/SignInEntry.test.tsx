import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SignInEntry } from "./SignInEntry";
import { useAccountStore } from "./useAccountStore";

describe("the header's account slot", () => {
  beforeEach(() => {
    useAccountStore.getState().clear();
    useAccountStore.setState({ availability: "available", phase: "anonymous", account: null });
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
      account: { userId: "u1", email: "reader@example.com", admittedAt: 1 },
    });
    const onSignOut = vi.fn();
    render(<SignInEntry onSignOut={onSignOut} />);

    expect(screen.getByTestId("account-chip")).toHaveTextContent("reader@example.com");
    fireEvent.click(screen.getByTestId("account-sign-out"));
    expect(onSignOut).toHaveBeenCalledTimes(1);
  });

  it("keeps a waiting account reachable after the panel is dismissed", () => {
    useAccountStore.getState().applySession({
      availability: "available",
      account: { userId: "u1", email: null, admittedAt: null },
    });
    useAccountStore.getState().finishClaim({
      claimed: [],
      unchanged: [],
      refused: [{ workspaceId: "ws-1", code: "admission-pending" }],
      attempted: 1,
      stopped: "admission",
    });

    render(<SignInEntry onSignOut={() => {}} />);
    fireEvent.click(screen.getByTestId("account-waiting"));
    expect(useAccountStore.getState().admissionOpen).toBe(true);
  });

  it("is a plain 'Sign in' on a deployment with no accounts, rather than nothing", () => {
    useAccountStore.setState({ availability: "unavailable", phase: "anonymous", account: null });
    render(<SignInEntry onSignOut={() => {}} />);
    // The entry stays, because clicking it is how someone learns *why* there is
    // no account here — the dialog explains instead of the app staying silent.
    expect(screen.getByTestId("sign-in-entry")).toBeInTheDocument();
  });
});
