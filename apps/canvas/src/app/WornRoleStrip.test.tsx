import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WornRoleStrip } from "./WornRoleStrip";

/**
 * The strip is the word for a capability that changed. It renders nothing for an account
 * wearing its own role, which is every account but an operator's.
 */
const readWornRole = vi.fn(async () => ({
  role: null as string | null,
  organizationId: null as string | null,
  realRole: "owner" as string | null,
}));

vi.mock("../session/roleOverride", () => ({
  readWornRole: () => readWornRole(),
}));

afterEach(() => {
  cleanup();
  readWornRole.mockClear();
});

describe("the worn role strip", () => {
  it("says nothing when the account is wearing its own role", async () => {
    render(<WornRoleStrip />);

    await Promise.resolve();
    expect(screen.queryByTestId("worn-role-strip")).toBeNull();
  });

  it("names the worn role, the real one, and where to clear it", async () => {
    readWornRole.mockResolvedValueOnce({
      role: "member",
      organizationId: "org-1",
      realRole: "owner",
    });

    render(<WornRoleStrip />);

    const strip = await screen.findByTestId("worn-role-strip");
    expect(strip.textContent).toContain("member");
    expect(strip.textContent).toContain("your own is owner");
    // The one thing the costume cannot reach, said where the costume is worn.
    expect(strip.textContent).toContain("billing still asks your real membership");
    expect(screen.getByTestId("worn-role-strip-clear").getAttribute("href")).toBe("/admin.html");
  });

  it("renders nothing when there is no account service to ask", async () => {
    readWornRole.mockRejectedValueOnce(new Error("no account service"));

    render(<WornRoleStrip />);

    await Promise.resolve();
    expect(screen.queryByTestId("worn-role-strip")).toBeNull();
  });
});
