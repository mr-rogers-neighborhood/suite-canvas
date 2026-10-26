import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { tabKeyDown } from "./tabKeys";

function Strip() {
  const tabs = ["one", "two", "three"] as const;
  const [tab, setTab] = useState<(typeof tabs)[number]>("one");
  return (
    <div
      role="tablist"
      aria-label="Test"
      onKeyDown={(event) =>
        tabKeyDown(event, tabs.indexOf(tab), tabs.length, (index) => {
          const next = tabs[index];
          if (next === undefined) return;
          setTab(next);
          document.getElementById(`tab-${next}`)?.focus();
        })
      }
    >
      {tabs.map((id) => (
        <button
          key={id}
          id={`tab-${id}`}
          type="button"
          role="tab"
          aria-selected={tab === id}
          tabIndex={tab === id ? 0 : -1}
          onClick={() => setTab(id)}
        >
          {id}
        </button>
      ))}
    </div>
  );
}

describe("tabKeyDown", () => {
  it("is one tab stop, with the selected tab in the tab order", () => {
    render(<Strip />);

    expect(screen.getByRole("tab", { name: "one" })).toHaveAttribute("tabindex", "0");
    expect(screen.getByRole("tab", { name: "two" })).toHaveAttribute("tabindex", "-1");
  });

  it("moves the selection and the focus with the arrows, and wraps", () => {
    render(<Strip />);
    const one = screen.getByRole("tab", { name: "one" });

    fireEvent.keyDown(one, { key: "ArrowRight" });
    expect(screen.getByRole("tab", { name: "two" })).toHaveFocus();
    expect(screen.getByRole("tab", { name: "two" })).toHaveAttribute("aria-selected", "true");

    fireEvent.keyDown(screen.getByRole("tab", { name: "two" }), { key: "ArrowRight" });
    fireEvent.keyDown(screen.getByRole("tab", { name: "three" }), { key: "ArrowRight" });
    expect(screen.getByRole("tab", { name: "one" })).toHaveFocus();
  });

  it("jumps to the ends with Home and End", () => {
    render(<Strip />);
    const one = screen.getByRole("tab", { name: "one" });

    fireEvent.keyDown(one, { key: "End" });
    expect(screen.getByRole("tab", { name: "three" })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole("tab", { name: "three" }), { key: "Home" });
    expect(screen.getByRole("tab", { name: "one" })).toHaveFocus();
  });
});
