import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ActivityPanel } from "./ActivityPanel";

/**
 * What the trail promises a reader: refusals are not hidden, a verb reads as a sentence,
 * and a second page continues where the first stopped rather than shifting under them.
 */
const entries = [
  {
    id: 2,
    at: 1_700_000_001_000,
    actor: "user-operator",
    action: "impersonate",
    target: "user-target",
    outcome: "ok",
    details: {},
  },
  {
    id: 1,
    at: 1_700_000_000_000,
    actor: "user-operator",
    action: "impersonate",
    target: "user-target",
    outcome: "refused",
    details: { code: "mfa-enrollment-required" },
  },
];

const older = [
  {
    id: 0,
    at: 1_699_999_999_000,
    actor: "user-operator",
    action: "settings.write",
    target: "billing.mode",
    outcome: "ok",
    details: { value: "live" },
  },
];

const listActivity = vi.fn(async (options: { before?: unknown }) => ({
  ok: true,
  entries: options.before === undefined ? entries : older,
  next: options.before === undefined ? { beforeAt: 1_700_000_000_000, beforeId: 1 } : null,
}));

vi.mock("../api", () => ({
  errorText: (cause: unknown) => String(cause),
  listActivity: (options: { before?: unknown }) => listActivity(options),
}));

afterEach(() => {
  cleanup();
  listActivity.mockClear();
});

describe("the activity panel", () => {
  it("reads the refusal as an act, not as a hidden row", async () => {
    render(<ActivityPanel />);
    await waitFor(() => expect(screen.getAllByText("Started a support session")).toHaveLength(2));

    expect(screen.getByText("refused")).toBeTruthy();
    expect(screen.getByText("code=mfa-enrollment-required")).toBeTruthy();
  });

  it("carries the watermark when it loads older rows", async () => {
    render(<ActivityPanel />);
    await waitFor(() => expect(screen.getByText("Load older")).toBeTruthy());

    fireEvent.click(screen.getByText("Load older"));

    await waitFor(() =>
      expect(listActivity).toHaveBeenLastCalledWith({
        limit: 50,
        before: { beforeAt: 1_700_000_000_000, beforeId: 1 },
      }),
    );
    expect(await screen.findByText("Changed a setting")).toBeTruthy();
    // The first page is still there, so the list grew rather than replaced itself.
    expect(screen.getAllByText("Started a support session")).toHaveLength(2);
  });

  it("drops the older rows when the filter changes, rather than mixing two questions", async () => {
    render(<ActivityPanel />);
    await waitFor(() => expect(screen.getByText("Load older")).toBeTruthy());
    fireEvent.click(screen.getByText("Load older"));
    await screen.findByText("Changed a setting");

    fireEvent.change(screen.getByLabelText("Filter by action"), {
      target: { value: "impersonate" },
    });
    fireEvent.click(screen.getByText("Apply"));

    await waitFor(() =>
      expect(listActivity).toHaveBeenLastCalledWith({ limit: 50, action: "impersonate" }),
    );
  });

  it("says so when nothing has happened", async () => {
    listActivity.mockResolvedValueOnce({ ok: true, entries: [], next: null });

    render(<ActivityPanel />);

    expect(await screen.findByText("Nothing has been done yet.")).toBeTruthy();
  });
});
