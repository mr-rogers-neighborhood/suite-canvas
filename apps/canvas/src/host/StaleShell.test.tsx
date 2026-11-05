import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StaleShell } from "./StaleShell";

describe("StaleShell", () => {
  it("says the shell is out of date and asks for a restart", () => {
    render(<StaleShell missing={["recentFiles"]} />);

    expect(screen.getByRole("heading")).toHaveTextContent("This window's shell is out of date.");
    expect(screen.getByText("Restart Suite to load the current shell.")).toBeInTheDocument();
  });

  it("offers no control, because only a restart replaces the shell", () => {
    render(<StaleShell missing={["recentFiles", "forgetRecent"]} />);

    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("keeps the missing methods for diagnostics rather than prose", () => {
    render(<StaleShell missing={["recentFiles", "forgetRecent"]} />);

    expect(screen.getByTestId("stale-shell")).toHaveAttribute(
      "data-missing",
      "recentFiles forgetRecent",
    );
  });
});
