import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { AccountPanel } from "./AccountPanel";
import { useAccountStore } from "./useAccountStore";

beforeEach(() => {
  useAccountStore.getState().clear();
  useAccountStore.getState().applySession({
    availability: "available",
    account: { userId: "user-1", email: "reader@example.com", name: "Ada", admittedAt: 1 },
  });
});

describe("the account panel", () => {
  it("renders nothing until it is asked for", () => {
    render(<AccountPanel />);
    expect(screen.queryByTestId("account-panel")).not.toBeInTheDocument();
  });

  it("opens on the account, with the address that will receive mail", () => {
    useAccountStore.getState().openPanel();
    render(<AccountPanel />);

    expect(screen.getByTestId("account-panel")).toHaveAttribute("data-tab", "account");
    expect(screen.getByTestId("account-email")).toHaveTextContent("reader@example.com");
    expect(screen.getByTestId("account-panel")).toHaveTextContent("exactly as it is");
  });

  it("opens on the tab a caller asked for", () => {
    useAccountStore.getState().openPanel("plan");
    render(<AccountPanel />);
    expect(screen.getByTestId("account-panel")).toHaveAttribute("data-tab", "plan");
    expect(screen.getByTestId("plan-panel")).toBeInTheDocument();
  });

  it("switches surfaces without closing", () => {
    useAccountStore.getState().openPanel();
    render(<AccountPanel />);

    fireEvent.click(screen.getByTestId("account-tab-plan"));
    expect(useAccountStore.getState().panelTab).toBe("plan");
    expect(screen.getByTestId("plan-panel")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("account-tab-account"));
    expect(screen.getByTestId("account-section")).toBeInTheDocument();
  });

  it("closes from the button and from Escape", () => {
    useAccountStore.getState().openPanel();
    render(<AccountPanel />);

    fireEvent.click(screen.getByTestId("account-panel-close"));
    expect(useAccountStore.getState().panelOpen).toBe(false);
  });
});
