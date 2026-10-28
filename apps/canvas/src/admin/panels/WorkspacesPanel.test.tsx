import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkspacesPanel } from "./WorkspacesPanel";

/**
 * The licence column's two promises: a state reads as the consequence the gate draws from
 * it, and writing one changes the row rather than sending a reader back to a page.
 */
const rows = [
  {
    id: "ws-expired",
    claimed: true,
    licence: {
      tier: "past-due",
      licenceId: "lic-1",
      expiresAt: 1_600_000_000_000,
      expired: true,
      email: null,
    },
    documentBytes: 2048,
    cards: 3,
    boards: 1,
    sections: 0,
    types: 2,
    tags: 0,
    shares: 0,
    lastSavedAt: 1_600_000_000_000,
  },
  {
    id: "ws-none",
    claimed: false,
    licence: null,
    documentBytes: 0,
    cards: 0,
    boards: 0,
    sections: 0,
    types: 0,
    tags: 0,
    shares: 0,
    lastSavedAt: null,
  },
];

const writeLicence = vi.fn(async () => {});
const clearLicence = vi.fn(async () => {});
const listWorkspaces = vi.fn(async () => ({ workspaces: rows, total: rows.length }));

vi.mock("../api", () => ({
  errorText: (cause: unknown) => String(cause),
  listWorkspaces: () => listWorkspaces(),
  writeLicence: (...args: unknown[]) => writeLicence(...(args as [])),
  clearLicence: (...args: unknown[]) => clearLicence(...(args as [])),
  getWorkspace: async () => ({ ...rows[0], shareList: [], versions: {}, schemaVersion: 1 }),
  revokeShare: async () => {},
  revokeAllShares: async () => {},
  deleteWorkspace: async () => {},
  downloadExport: async () => {},
}));

afterEach(() => {
  cleanup();
  writeLicence.mockClear();
  clearLicence.mockClear();
  listWorkspaces.mockClear();
});

describe("the licence column", () => {
  it("reads an expired row as the gate's refusal, not just a word", async () => {
    render(<WorkspacesPanel />);

    expect((await screen.findByTestId("licence-ws-expired")).textContent).toContain("expired");
    expect(screen.getByTestId("licence-consequence-ws-expired").textContent).toBe(
      "sync is refused while this is expired",
    );
    // No row at all is a cancellation, and says what that means too.
    expect(screen.getByTestId("licence-consequence-ws-none").textContent).toBe(
      "no licence, so sync is refused",
    );
  });

  it("writes the state that was pressed and reloads the list", async () => {
    render(<WorkspacesPanel />);
    const cell = await screen.findByTestId("licence-ws-none");

    fireEvent.click(within(cell).getByText("Trial"));

    await waitFor(() => expect(writeLicence).toHaveBeenCalledWith("ws-none", "trial"));
    await waitFor(() => expect(listWorkspaces).toHaveBeenCalledTimes(2));
  });

  it("cancels by clearing the row", async () => {
    render(<WorkspacesPanel />);
    const cell = await screen.findByTestId("licence-ws-expired");

    fireEvent.click(within(cell).getByText("Cancel"));

    await waitFor(() => expect(clearLicence).toHaveBeenCalledWith("ws-expired"));
  });

  it("cannot cancel a workspace that has no licence to clear", async () => {
    render(<WorkspacesPanel />);
    const cell = await screen.findByTestId("licence-ws-none");

    const cancel = within(cell).getByText("Cancel") as HTMLButtonElement;

    expect(cancel.disabled).toBe(true);
  });
});
