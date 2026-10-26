import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { WorkspaceActions } from "./WorkspaceActions";

/**
 * The workspace menu opened under its trigger and left focus there, so the
 * arrow keys its role promised never reached the menu's own handler.
 */
describe("the workspace menu", () => {
  it("moves focus into the menu when it opens", () => {
    render(<WorkspaceActions workspaceId="w1" boardId={null} title="Research" />);

    fireEvent.click(screen.getByTestId("workspace-menu"));

    const active = document.activeElement;
    expect(active).toHaveAttribute("role", "menuitem");
    expect(screen.getByTestId("workspace-menu-list").contains(active)).toBe(true);
  });

  it("steps to the last row with End", () => {
    render(<WorkspaceActions workspaceId="w1" boardId={null} title="Research" />);
    fireEvent.click(screen.getByTestId("workspace-menu"));

    fireEvent.keyDown(document.activeElement as HTMLElement, { key: "End" });

    const rows = screen.getAllByRole("menuitem");
    expect(rows.at(-1)).toHaveFocus();
  });
});
