import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { BOARD_NAME_PILL_ATTRIBUTE, BoardRenameInput, boardNamePillRect } from "./BoardRenameInput";

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

function renderInput(overrides: Partial<Parameters<typeof BoardRenameInput>[0]> = {}) {
  const onCommit = vi.fn();
  const onCancel = vi.fn();
  render(
    <BoardRenameInput
      boardId="board-1"
      name="Research"
      fallback={{ x: 40, y: 60 }}
      onCommit={onCommit}
      onCancel={onCancel}
      {...overrides}
    />,
  );
  return { onCommit, onCancel, input: screen.getByTestId("board-rename-input") };
}

describe("BoardRenameInput", () => {
  it("opens on the Board's current name, focused", () => {
    const { input } = renderInput();
    expect(input).toHaveValue("Research");
    expect(input).toBe(document.activeElement);
  });

  it("commits the new name once on Enter", () => {
    const { onCommit, onCancel, input } = renderInput();

    fireEvent.change(input, { target: { value: "Field notes" } });
    fireEvent.keyDown(input, { key: "Enter" });
    // A blur after Enter must not write a second time.
    fireEvent.blur(input);

    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith("Field notes");
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("cancels on Escape without a write", () => {
    const { onCommit, onCancel, input } = renderInput();

    fireEvent.change(input, { target: { value: "Nope" } });
    fireEvent.keyDown(input, { key: "Escape" });
    fireEvent.blur(input);

    expect(onCommit).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("treats an unchanged or blank name as no edit", () => {
    const unchanged = renderInput();
    fireEvent.blur(unchanged.input);
    expect(unchanged.onCommit).not.toHaveBeenCalled();
    expect(unchanged.onCancel).toHaveBeenCalledTimes(1);

    cleanup();
    const blank = renderInput();
    fireEvent.change(blank.input, { target: { value: "   " } });
    fireEvent.blur(blank.input);
    expect(blank.onCommit).not.toHaveBeenCalled();
  });

  it("stands on the Board's name pill when the face layer has drawn one", () => {
    const pill = document.createElement("div");
    pill.setAttribute(BOARD_NAME_PILL_ATTRIBUTE, "board-1");
    // jsdom has no layout, so the numbers are stubbed: the point is that the
    // field uses *the pill's* box rather than the fallback point.
    vi.spyOn(pill, "getBoundingClientRect").mockReturnValue({
      left: 300,
      top: 220,
      width: 180,
      height: 18,
      right: 480,
      bottom: 238,
      x: 300,
      y: 220,
      toJSON: () => ({}),
    });
    document.body.append(pill);

    const { input } = renderInput();
    expect(input.style.left).toBe("300px");
    expect(input.style.top).toBe("220px");
    expect(input.style.width).toBe("180px");
  });

  it("falls back to the point the menu was opened at", () => {
    const { input } = renderInput({ fallback: { x: 12, y: 34 } });
    expect(input.style.left).toBe("12px");
    expect(input.style.top).toBe("34px");
  });
});

describe("boardNamePillRect", () => {
  it("answers null without a document or a drawn pill", () => {
    expect(boardNamePillRect("board-1", null)).toBeNull();
    expect(boardNamePillRect("board-1", document)).toBeNull();
  });
});
