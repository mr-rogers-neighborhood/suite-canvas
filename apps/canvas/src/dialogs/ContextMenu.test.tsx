import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ContextMenu } from "./ContextMenu";

function open() {
  render(
    <ContextMenu
      x={10}
      y={10}
      items={[
        { label: "Open" },
        { label: "Position", items: [{ label: "Above" }, { label: "Below" }] },
        { label: "Delete", danger: true },
      ]}
      onClose={() => {}}
    />,
  );
}

/**
 * The menu is portalled to `body` at the pointer, so Tab from the trigger went
 * to the end of the document. It has to take focus itself for the arrows its
 * role promises to arrive at all.
 */
describe("a context menu", () => {
  it("takes focus on its first item when it opens", () => {
    open();

    expect(screen.getByRole("menuitem", { name: "Open" })).toHaveFocus();
  });

  it("walks its own rows with the arrows", () => {
    open();
    const first = screen.getByRole("menuitem", { name: "Open" });
    const last = screen.getByRole("menuitem", { name: "Delete" });

    fireEvent.keyDown(first, { key: "End" });
    expect(last).toHaveFocus();

    fireEvent.keyDown(last, { key: "Home" });
    expect(first).toHaveFocus();
  });
});
