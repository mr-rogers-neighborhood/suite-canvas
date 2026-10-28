import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NoticeStrip } from "./NoticeStrip";

/**
 * The strip exists so an account finds out that support looked without being mailed. What
 * matters: it says nothing when there is nothing to say, and dismissing ends the ladder
 * rather than repeating it.
 */
const markNoticeRead = vi.fn(async () => {});
const readNotices = vi.fn(
  async () =>
    ({ notices: [], unread: 0 }) as {
      notices: {
        id: number;
        kind: string;
        body: string;
        createdAt: number;
        readAt: number | null;
      }[];
      unread: number;
    },
);

vi.mock("../session/accountNotices", () => ({
  readNotices: () => readNotices(),
  markNoticeRead: (...args: unknown[]) => markNoticeRead(...(args as [])),
}));

afterEach(() => {
  cleanup();
  markNoticeRead.mockClear();
  readNotices.mockClear();
});

const notice = {
  id: 3,
  kind: "support-view",
  body: "Someone on the team opened your account on Tuesday.",
  createdAt: 1,
  readAt: null,
};

describe("the notice strip", () => {
  it("renders nothing when everything has been read", async () => {
    render(<NoticeStrip />);

    await waitFor(() => expect(readNotices).toHaveBeenCalled());
    expect(screen.queryByTestId("notice-strip")).toBeNull();
  });

  it("shows the newest unread notice and marks it read when dismissed", async () => {
    readNotices.mockResolvedValueOnce({ notices: [notice], unread: 1 });
    render(<NoticeStrip />);

    expect((await screen.findByTestId("notice-strip")).textContent).toContain(
      "opened your account",
    );
    fireEvent.click(screen.getByTestId("notice-strip-dismiss"));

    await waitFor(() => expect(markNoticeRead).toHaveBeenCalledWith(3));
    expect(screen.queryByTestId("notice-strip")).toBeNull();
  });

  it("says how many more are waiting", async () => {
    readNotices.mockResolvedValueOnce({ notices: [notice, { ...notice, id: 2 }], unread: 2 });
    render(<NoticeStrip />);

    expect((await screen.findByTestId("notice-strip")).textContent).toContain("1 more");
  });
});
