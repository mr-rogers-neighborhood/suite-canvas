import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AcceptInvitation, invitationIdFromUrl } from "./AcceptInvitation";
import { useAccountStore } from "./useAccountStore";

beforeEach(() => {
  useAccountStore.getState().clear();
  useAccountStore.getState().applySession({
    availability: "available",
    account: { userId: "user-1", email: "reader@example.com", name: null, admittedAt: 1 },
  });
});

describe("accepting an invitation", () => {
  it("asks for a sign-in first, because the invitation is bound to an address", () => {
    useAccountStore.setState({ phase: "signed-out", account: null });
    render(<AcceptInvitation invitationId="inv-1" accept={vi.fn()} />);

    expect(screen.getByTestId("accept-invitation")).toHaveTextContent(
      "only works for that address",
    );
    fireEvent.click(screen.getByTestId("accept-invitation-sign-in"));
    expect(useAccountStore.getState().dialogOpen).toBe(true);
    expect(useAccountStore.getState().dialogMode).toBe("sign-in");
  });

  it("accepts once signed in, naming the account it adds", async () => {
    const accept = vi.fn(async () => ({ ok: true as const }));
    render(<AcceptInvitation invitationId="inv-1" accept={accept} />);

    expect(screen.getByTestId("accept-invitation")).toHaveTextContent("reader@example.com");
    fireEvent.click(screen.getByTestId("accept-invitation-submit"));

    await waitFor(() => expect(accept).toHaveBeenCalledWith("inv-1"));
    expect(await screen.findByTestId("accept-invitation-done")).toHaveTextContent("You are in");
  });

  it("reports a refusal rather than pretending it worked", async () => {
    const accept = vi.fn(async () => ({
      ok: false as const,
      message: "This invitation was sent to another address.",
    }));
    render(<AcceptInvitation invitationId="inv-1" accept={accept} />);

    fireEvent.click(screen.getByTestId("accept-invitation-submit"));
    expect(await screen.findByTestId("accept-invitation-error")).toHaveTextContent(
      "another address",
    );
    expect(screen.queryByTestId("accept-invitation-done")).not.toBeInTheDocument();
  });
});

describe("the invitation URL", () => {
  it("is the landing path with an id", () => {
    expect(invitationIdFromUrl("https://app.test/accept-invitation?id=inv-1")).toBe("inv-1");
    expect(invitationIdFromUrl("https://app.test/accept-invitation/?id=inv-2")).toBe("inv-2");
  });

  it("is null anywhere else, including a landing with no id", () => {
    expect(invitationIdFromUrl("https://app.test/accept-invitation")).toBeNull();
    expect(invitationIdFromUrl("https://app.test/?workspace=ws-1")).toBeNull();
    expect(invitationIdFromUrl("https://app.test/accept-invitation?id=%20")).toBeNull();
    expect(invitationIdFromUrl("not a url")).toBeNull();
  });
});
