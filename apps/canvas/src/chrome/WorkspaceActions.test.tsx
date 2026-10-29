import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { OPERATOR_TOKEN_KEY } from "../templates/operatorToken";
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
});

/**
 * Capturing a starter template writes through the operator token, so the row
 * exists only where a token does: offering it to everyone would be an invitation
 * to a request that can only be refused.
 */
describe("saving the workspace as a starter template", () => {
  afterEach(() => {
    window.sessionStorage.clear();
  });

  it("offers nothing when this tab holds no operator token", () => {
    render(<WorkspaceActions workspaceId="w1" title="Research" />);
    fireEvent.click(screen.getByTestId("workspace-menu"));

    expect(screen.queryByTestId("workspace-save-template")).not.toBeInTheDocument();
  });

  it("offers the row with a token and opens the prompt from it", () => {
    window.sessionStorage.setItem(OPERATOR_TOKEN_KEY, "operator-token");
    render(<WorkspaceActions workspaceId="w1" title="Research" />);
    fireEvent.click(screen.getByTestId("workspace-menu"));

    fireEvent.click(screen.getByTestId("workspace-save-template"));

    // The menu closes behind it and the prompt carries the workspace's own title.
    expect(screen.queryByTestId("workspace-menu-list")).not.toBeInTheDocument();
    expect(screen.getByTestId("save-template-dialog")).toBeInTheDocument();
    expect(screen.getByTestId("save-template-name")).toHaveValue("Research");
  });
});
