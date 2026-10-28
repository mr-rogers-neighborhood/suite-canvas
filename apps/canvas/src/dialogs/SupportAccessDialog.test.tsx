import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

/** Hoisted so the factory below can close over it. */
const { markNoticeRead } = vi.hoisted(() => ({ markNoticeRead: vi.fn(async () => {}) }));

vi.mock("../session/accountNotices", () => ({
  readNotices: async () => ({
    notices: [
      {
        id: 7,
        kind: "support-view",
        body: "Someone on the team that runs this deployment opened your account on Tuesday.",
        createdAt: 1,
        readAt: null,
      },
    ],
    unread: 1,
  }),
  markNoticeRead: (...args: unknown[]) => markNoticeRead(...(args as [])),
}));

import { SupportAccessDialog } from "./SupportAccessDialog";

/**
 * The account's own consent switch. What matters is that it reads the current state
 * rather than assuming off, that turning it off is one click, and that a failed change
 * does not *look* like it worked.
 */
afterEach(cleanup);

describe("the support access dialog", () => {
  it("reads the current state instead of assuming it", async () => {
    const read = vi.fn(async () => ({ granted: true, grantedAt: 1_700_000_000_000 }));
    render(<SupportAccessDialog onClose={() => {}} read={read} />);

    const state = await screen.findByTestId("support-access-state");
    expect(state.getAttribute("data-granted")).toBe("true");
    expect(state.textContent).toContain("Support access is on");
  });

  it("turns access off in one click", async () => {
    const write = vi.fn(async () => ({ granted: false, grantedAt: null }));
    render(
      <SupportAccessDialog
        onClose={() => {}}
        read={async () => ({ granted: true, grantedAt: 1_700_000_000_000 })}
        write={write}
      />,
    );

    fireEvent.click(await screen.findByTestId("support-access-toggle"));

    await waitFor(() => expect(write).toHaveBeenCalledWith(false));
    expect((await screen.findByTestId("support-access-state")).getAttribute("data-granted")).toBe(
      "false",
    );
  });

  it("says so when the change did not save", async () => {
    render(
      <SupportAccessDialog
        onClose={() => {}}
        read={async () => ({ granted: false, grantedAt: null })}
        write={async () => {
          throw new Error("The server did not answer; nothing changed.");
        }}
      />,
    );

    fireEvent.click(await screen.findByTestId("support-access-toggle"));

    expect((await screen.findByRole("alert")).textContent).toContain("nothing changed");
    // The state did not flip on a failed write.
    expect(screen.getByTestId("support-access-state").getAttribute("data-granted")).toBe("false");
  });
});

describe("the history beside the switch", () => {
  it("says nobody has looked, when nobody has", async () => {
    render(
      <SupportAccessDialog
        onClose={() => {}}
        read={async () => ({ granted: false, grantedAt: null })}
      />,
    );

    const history = await screen.findByTestId("support-access-history");
    expect(history.textContent).toContain("Nobody has opened your account");
  });

  it("lists what support did, and marks an unread one read", async () => {
    render(
      <SupportAccessDialog
        onClose={() => {}}
        read={async () => ({ granted: true, grantedAt: 1 })}
      />,
    );

    // Wait for the notice itself: the empty state renders first, and its node is replaced.
    const body = await screen.findByText(/^Someone on the team/u);
    expect(body.closest("li")?.getAttribute("data-read")).toBe("false");

    fireEvent.click(within(body.closest("li") as HTMLElement).getByText("Mark read"));

    await waitFor(() =>
      expect(
        screen
          .getByText(/^Someone on the team/u)
          .closest("li")
          ?.getAttribute("data-read"),
      ).toBe("true"),
    );
    expect(markNoticeRead).toHaveBeenCalledWith(7);
  });
});
