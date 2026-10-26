import type { Section } from "@suite/graph";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { OutlineTree } from "../BoardOutline";
import type { PeekController } from "./usePeek";

/** The outline is the first surface to offer a peek, so it is where the wiring is proved. */

const section: Section = {
  id: "section-1",
  boardId: "board-1",
  title: "Act one",
  x: 0,
  y: 0,
  width: 400,
  height: 300,
  z: 0,
  tags: [],
  createdAt: 0,
  updatedAt: 0,
};

function controller(overrides: Partial<PeekController> = {}): PeekController {
  return {
    peek: null,
    hover: vi.fn(),
    focus: vi.fn(),
    leave: vi.fn(),
    stay: vi.fn(),
    dismiss: vi.fn(),
    ...overrides,
  };
}

function renderRail(peek: PeekController, onSelect = vi.fn()) {
  render(
    <OutlineTree
      sections={[section]}
      membership={new Map()}
      peers={[]}
      selectedSectionId={null}
      open
      onToggle={() => {}}
      onSelect={onSelect}
      onContextMenu={() => {}}
      peek={peek}
    />,
  );
  return onSelect;
}

describe("outline peek wiring", () => {
  it("should name the section the pointer rests on", () => {
    const peek = controller();
    renderRail(peek);
    const row = screen.getByTestId("outline-row");
    fireEvent.pointerEnter(row);
    expect(peek.hover).toHaveBeenCalledWith({ kind: "section", id: section.id }, null);
  });

  it("should open on keyboard focus straight away", () => {
    const peek = controller();
    renderRail(peek);
    fireEvent.focus(screen.getByTestId("outline-row"));
    expect(peek.focus).toHaveBeenCalledWith({ kind: "section", id: section.id }, null);
  });

  it("should hand the grace period back when the pointer leaves", () => {
    const peek = controller();
    renderRail(peek);
    const row = screen.getByTestId("outline-row");
    fireEvent.pointerLeave(row);
    fireEvent.blur(row);
    expect(peek.leave).toHaveBeenCalledTimes(2);
  });

  it("should render the open peek over the rail", () => {
    const peek = controller({
      peek: {
        entity: {
          target: { kind: "section", id: section.id },
          label: "Act one",
          kindLabel: "section",
          detail: "On Board 1",
        },
        anchor: { x: 10, y: 20 },
      },
    });
    renderRail(peek);
    expect(screen.getByTestId("peek-label")).toHaveTextContent("Act one");
  });

  it("should open the section the peek names and close the peek", () => {
    const peek = controller({
      peek: {
        entity: {
          target: { kind: "section", id: section.id },
          label: "Act one",
          kindLabel: "section",
          detail: null,
        },
        anchor: null,
      },
    });
    const onSelect = renderRail(peek);
    fireEvent.click(screen.getByTestId("peek-open"));
    expect(onSelect).toHaveBeenCalledWith(section.id);
    expect(peek.dismiss).toHaveBeenCalledTimes(1);
  });

  it("should keep the rail working with no peek controller at all", () => {
    render(
      <OutlineTree
        sections={[section]}
        membership={new Map()}
        peers={[]}
        selectedSectionId={null}
        open
        onToggle={() => {}}
        onSelect={() => {}}
        onContextMenu={() => {}}
      />,
    );
    fireEvent.pointerEnter(screen.getByTestId("outline-row"));
    expect(screen.queryByTestId("peek-surface")).toBeNull();
  });
});
