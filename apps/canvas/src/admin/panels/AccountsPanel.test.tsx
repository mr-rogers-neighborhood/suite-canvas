import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AccountsPanel } from "./AccountsPanel";

/**
 * What the panel promises about impersonation: it says why the button is off, it never
 * offers a way to *give* consent, and it leaves a way back out.
 */
const accounts = [
  {
    id: "user-allowed",
    email: "allowed@example.com",
    name: "Allowed Person",
    role: "member",
    createdAt: "2026-01-01T00:00:00.000Z",
    twoFactorEnabled: true,
    supportAccess: { granted: true, grantedAt: 1_700_000_000_000, revokedAt: null },
  },
  {
    id: "user-refused",
    email: "refused@example.com",
    name: null,
    role: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    twoFactorEnabled: true,
    supportAccess: { granted: false, grantedAt: null, revokedAt: null },
  },
  {
    id: "user-no-factor",
    email: "nofactor@example.com",
    name: "No Factor",
    role: "member",
    createdAt: "2026-01-01T00:00:00.000Z",
    twoFactorEnabled: false,
    supportAccess: { granted: true, grantedAt: 1_700_000_000_000, revokedAt: null },
  },
];

const impersonate = vi.fn<() => Promise<void>>(async () => {});
class FakeApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code: string | null = null,
  ) {
    super(message);
  }
}
const stopImpersonating = vi.fn(async () => {});
const revokeSupportAccess = vi.fn(async () => {});

vi.mock("../api", () => ({
  // The class has to be built inside the factory: `vi.mock` is hoisted above the file.
  AdminApiError: class extends Error {
    constructor(
      readonly status: number,
      message: string,
      readonly code: string | null = null,
    ) {
      super(message);
    }
  },
  errorText: (cause: unknown) => (cause instanceof Error ? cause.message : String(cause)),
  listAccounts: async () => ({ ok: true, accounts }),
  readOwnSession: async () => ({ email: "op@example.com", twoFactorEnabled: false }),
  beginTotpEnrolment: async () => ({
    totpURI: "otpauth://totp/Suite:op@example.com?secret=ABC",
    backupCodes: ["a-b", "c-d"],
  }),
  confirmTotp: async () => {},
  impersonate: (...args: unknown[]) => impersonate(...(args as [])),
  stopImpersonating: () => stopImpersonating(),
  revokeSupportAccess: (...args: unknown[]) => revokeSupportAccess(...(args as [])),
}));

afterEach(() => {
  cleanup();
  window.sessionStorage.clear();
  impersonate.mockClear();
  stopImpersonating.mockClear();
  revokeSupportAccess.mockClear();
});

const byAccount = (id: string): HTMLElement => {
  const node = document.querySelector(`[data-account="${id}"]`);
  if (node === null) throw new Error(`no row for ${id}`);
  return node as HTMLElement;
};

describe("the accounts panel", () => {
  it("offers impersonation only where the account allowed it", async () => {
    render(<AccountsPanel />);
    await waitFor(() => expect(screen.getByText("allowed@example.com")).toBeTruthy());

    const allowed = byAccount("user-allowed").querySelector("button[class*='primary']");
    const refused = byAccount("user-refused").querySelector("button[class*='primary']");

    expect((allowed as HTMLButtonElement).disabled).toBe(false);
    expect((refused as HTMLButtonElement).disabled).toBe(true);
    expect((refused as HTMLButtonElement).title).toContain("has not allowed support access");
  });

  it("says when the missing second factor is the reason", async () => {
    render(<AccountsPanel />);
    await waitFor(() => expect(screen.getByText("nofactor@example.com")).toBeTruthy());

    const button = byAccount("user-no-factor").querySelector(
      "button[class*='primary']",
    ) as HTMLButtonElement;

    expect(button.disabled).toBe(true);
    expect(button.title).toContain("no second factor");
  });

  it("can only end a grant, never start one", async () => {
    render(<AccountsPanel />);
    await waitFor(() => expect(screen.getByText("allowed@example.com")).toBeTruthy());

    // The allowed row has the ending control; the refused row has nothing to end.
    expect(byAccount("user-allowed").textContent).toContain("End access");
    expect(byAccount("user-refused").textContent).not.toContain("End access");
  });

  it("leaves a way back out after impersonating", async () => {
    render(<AccountsPanel />);
    await waitFor(() => expect(screen.getByText("allowed@example.com")).toBeTruthy());

    const button = byAccount("user-allowed").querySelector(
      "button[class*='primary']",
    ) as HTMLButtonElement;
    fireEvent.click(button);

    await waitFor(() => expect(impersonate).toHaveBeenCalledWith("user-allowed"));
    const banner = await screen.findByTestId("impersonation-banner");
    expect(banner.textContent).toContain("allowed@example.com");

    fireEvent.click(screen.getByText("Stop impersonating"));
    await waitFor(() => expect(stopImpersonating).toHaveBeenCalled());
    expect(window.sessionStorage.getItem("suite.admin.impersonating")).toBeNull();
  });
});

describe("when the operator has no second factor", () => {
  it("says how to fix it, rather than guessing", async () => {
    impersonate.mockRejectedValueOnce(
      new FakeApiError(
        403,
        "This account can manage people, so it needs a second factor.",
        "mfa-enrollment-required",
      ),
    );
    render(<AccountsPanel />);
    await waitFor(() => expect(screen.getByText("allowed@example.com")).toBeTruthy());

    const button = byAccount("user-allowed").querySelector(
      "button[class*='primary']",
    ) as HTMLButtonElement;
    fireEvent.click(button);

    expect((await screen.findByTestId("mfa-hint")).textContent).toContain("second factor");
    // The impersonation did not start, so there is nothing to stop.
    expect(screen.queryByTestId("impersonation-banner")).toBeNull();
  });
});

describe("the second factor card", () => {
  it("offers enrolment when the account has none", async () => {
    render(<AccountsPanel />);

    expect((await screen.findByTestId("second-factor")).textContent).toContain(
      "needs a second factor",
    );
    expect(screen.getByLabelText("Your password")).toBeTruthy();
  });
});
