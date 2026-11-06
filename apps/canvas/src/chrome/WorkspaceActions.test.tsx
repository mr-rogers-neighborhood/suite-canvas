import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { WorkspaceActions } from "./WorkspaceActions";

/**
 * The workspace menu opened under its trigger and left focus there, so the
 * arrow keys its role promised never reached the menu's own handler.
 */
describe("the workspace menu", () => {
  it("moves focus into the menu when it opens", () => {
    render(<WorkspaceActions workspaceId="w1" title="Research" />);

    fireEvent.click(screen.getByTestId("workspace-menu"));

    const active = document.activeElement;
    expect(active).toHaveAttribute("role", "menuitem");
    expect(screen.getByTestId("workspace-menu-list").contains(active)).toBe(true);
  });

  it("steps to the last row with End", () => {
    render(<WorkspaceActions workspaceId="w1" title="Research" />);
    fireEvent.click(screen.getByTestId("workspace-menu"));

    fireEvent.keyDown(document.activeElement as HTMLElement, { key: "End" });

    const rows = screen.getAllByRole("menuitem");
    expect(rows.at(-1)).toHaveFocus();
  });

  it("renders both standard and compact backup export options", () => {
    render(<WorkspaceActions workspaceId="w1" title="Research" />);
    fireEvent.click(screen.getByTestId("workspace-menu"));

    expect(screen.getByTestId("workspace-export-backup")).toHaveTextContent("Export backup…");
    expect(screen.getByTestId("workspace-export-compact")).toHaveTextContent(
      "Export compact (.suite)…",
    );
  });
});

/**
 * A starter template used to be captured here and posted to a control plane.
 * Both are gone, so the row is gone with them: a menu entry for a request that
 * cannot succeed is worse than no row at all.
 */
describe("a starter template row", () => {
  afterEach(() => {
    window.sessionStorage.clear();
  });

  it("never offers a template row: templates are written by hand now", () => {
    // The row posted to a control plane that no longer exists, so it is gone
    // rather than hidden behind a token nobody can obtain.
    window.sessionStorage.setItem("suite:operator-token", "operator-token");
    render(<WorkspaceActions workspaceId="w1" title="Research" />);
    fireEvent.click(screen.getByTestId("workspace-menu"));

    expect(screen.queryByTestId("workspace-save-template")).not.toBeInTheDocument();
  });
});
