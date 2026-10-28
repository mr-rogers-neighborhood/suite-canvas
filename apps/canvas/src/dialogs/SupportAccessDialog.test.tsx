import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
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
