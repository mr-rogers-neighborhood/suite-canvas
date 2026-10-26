import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ShortcutSheet, ShortcutSheetHost } from "./ShortcutSheet";
import { openShortcutSheet, shortcutGroups, shortcutRows } from "./shortcutSheet";

/**
 * The registry carried a `shortcut` field that nothing rendered, so the numbers
 * the app answered were private knowledge.
 */
describe("shortcut rows", () => {
  it("names the keys the palette and the board answer", () => {
    const keys = shortcutRows().map((row) => row.keys);

    expect(keys).toContain("\u2318K");
    expect(keys).toContain("\u2318\u21e7K");
    // Documented nowhere before the sheet.
    expect(keys).toContain("\u2318Enter");
    expect(keys).toContain("\u2318G");
    expect(keys).toContain("\u2318Z");
    expect(keys).toContain("[");
  });

  it("groups the rows in registry order, then the board's own keys", () => {
    const groups = shortcutGroups();

    expect(groups[0]?.group).toBe("navigation");
    expect(groups.at(-1)?.group).toBe("keys");
  });
});

describe("the shortcut sheet", () => {
  it("draws every row it is given", () => {
    render(<ShortcutSheet onClose={() => {}} />);

    const labels = screen.getAllByTestId("shortcut-sheet-row").map((row) => row.textContent);
    expect(labels).toContain("New card");
    expect(labels).toContain("New section");
    expect(labels).toContain("Show or hide the outline");
    expect(screen.getByTestId("shortcut-sheet")).toHaveTextContent("\u2318Enter");
  });

  it("closes on Escape and on the close control", () => {
    const onClose = vi.fn();
    render(<ShortcutSheet onClose={onClose} />);

    fireEvent.keyDown(screen.getByTestId("shortcut-sheet"), { key: "Escape" });
    fireEvent.click(screen.getByTestId("shortcut-sheet-close"));

    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("opens when a surface asks for it", async () => {
    render(<ShortcutSheetHost />);
    expect(screen.queryByTestId("shortcut-sheet")).toBeNull();

    openShortcutSheet();

    await waitFor(() => expect(screen.getByTestId("shortcut-sheet")).toBeTruthy());
  });
});
