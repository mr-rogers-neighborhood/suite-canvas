import { fireEvent, render, screen } from "@testing-library/react";
import { useRef, useState } from "react";
import { describe, expect, it } from "vitest";
import { useFocusTrap } from "./useFocusTrap";

function Panel({ onClose }: { onClose: () => void }) {
  const panel = useRef<HTMLDivElement | null>(null);
  useFocusTrap(panel);
  return (
    <div ref={panel} role="dialog" aria-modal="true" aria-label="Trapped" tabIndex={-1}>
      <button type="button" data-testid="first">
        First
      </button>
      <button type="button" data-testid="last" onClick={onClose}>
        Last
      </button>
    </div>
  );
}

function Harness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" data-testid="opener" onClick={() => setOpen(true)}>
        Open
      </button>
      {open ? <Panel onClose={() => setOpen(false)} /> : null}
    </>
  );
}

describe("useFocusTrap", () => {
  it("moves focus into the panel, wraps Tab, and gives focus back on close", () => {
    render(<Harness />);
    const opener = screen.getByTestId("opener");
    opener.focus();
    fireEvent.click(opener);

    const first = screen.getByTestId("first");
    const last = screen.getByTestId("last");
    expect(first).toHaveFocus();

    fireEvent.keyDown(last, { key: "Tab" });
    expect(first).toHaveFocus();

    first.focus();
    fireEvent.keyDown(first, { key: "Tab", shiftKey: true });
    expect(last).toHaveFocus();

    fireEvent.click(last);
    expect(opener).toHaveFocus();
  });
});
