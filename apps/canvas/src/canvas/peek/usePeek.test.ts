import type { Target } from "@suite/graph";
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PeekEntity } from "./peekResolver";
import { peekTiming } from "./peekTiming";
import { usePeek } from "./usePeek";

function entity(id: string): PeekEntity {
  return {
    target: { kind: "card", id },
    label: id,
    kindLabel: "note",
    detail: null,
  };
}

const alpha: Target = { kind: "card", id: "alpha" };
const beta: Target = { kind: "card", id: "beta" };

function setup() {
  const resolve = (target: Target) => (target.id === "missing" ? null : entity(target.id));
  return renderHook(() => usePeek(resolve));
}

describe("usePeek", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should wait for a rest before it opens", () => {
    const { result } = setup();
    act(() => result.current.hover(alpha));
    expect(result.current.peek).toBeNull();

    act(() => {
      vi.advanceTimersByTime(peekTiming.openAfterMs - 1);
    });
    expect(result.current.peek).toBeNull();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current.peek?.entity.label).toBe("alpha");
  });

  it("should open the row the pointer settled on, not the first one it crossed", () => {
    const { result } = setup();
    act(() => result.current.hover(alpha));
    act(() => result.current.hover(beta));
    act(() => {
      vi.advanceTimersByTime(peekTiming.openAfterMs);
    });
    expect(result.current.peek?.entity.label).toBe("beta");
  });

  it("should not open when the pointer has already left", () => {
    const { result } = setup();
    act(() => result.current.hover(alpha));
    act(() => result.current.leave());
    act(() => {
      vi.advanceTimersByTime(peekTiming.openAfterMs);
    });
    expect(result.current.peek).toBeNull();
  });

  it("should keep the peek through the grace period and close after it", () => {
    const { result } = setup();
    act(() => result.current.hover(alpha));
    act(() => {
      vi.advanceTimersByTime(peekTiming.openAfterMs);
    });

    act(() => result.current.leave());
    act(() => {
      vi.advanceTimersByTime(peekTiming.closeAfterMs - 1);
    });
    expect(result.current.peek).not.toBeNull();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current.peek).toBeNull();
  });

  it("should stay open while the pointer is inside the peek", () => {
    const { result } = setup();
    act(() => result.current.hover(alpha));
    act(() => {
      vi.advanceTimersByTime(peekTiming.openAfterMs);
    });
    act(() => result.current.leave());
    act(() => result.current.stay());
    act(() => {
      vi.advanceTimersByTime(peekTiming.closeAfterMs * 4);
    });
    expect(result.current.peek).not.toBeNull();
  });

  it("should open at once for a keyboard focus", () => {
    const { result } = setup();
    act(() => result.current.focus(beta));
    expect(result.current.peek?.entity.label).toBe("beta");
  });

  it("should not open on the focus a click brings", () => {
    const { result } = setup();
    act(() => {
      window.dispatchEvent(new Event("pointerdown"));
    });
    act(() => result.current.focus(beta));
    expect(result.current.peek).toBeNull();
  });

  it("should open on a keyboard focus that follows an older click", () => {
    const { result } = setup();
    act(() => {
      window.dispatchEvent(new Event("pointerdown"));
    });
    act(() => {
      vi.advanceTimersByTime(peekTiming.pointerFocusGraceMs);
    });
    act(() => result.current.focus(beta));
    expect(result.current.peek?.entity.label).toBe("beta");
  });

  it("should dismiss on Escape", () => {
    const { result } = setup();
    act(() => result.current.focus(beta));
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(result.current.peek).toBeNull();
  });

  it("should dismiss on a pointer press anywhere", () => {
    const { result } = setup();
    act(() => result.current.focus(beta));
    act(() => {
      window.dispatchEvent(new Event("pointerdown"));
    });
    expect(result.current.peek).toBeNull();
  });

  it("should keep the peek open for a press inside it, so its route still works", () => {
    const { result } = setup();
    act(() => result.current.focus(beta));

    const surface = document.createElement("div");
    surface.setAttribute("data-peek-surface", "");
    const button = document.createElement("button");
    surface.append(button);
    document.body.append(surface);

    act(() => {
      button.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    });
    expect(result.current.peek).not.toBeNull();
    surface.remove();
  });

  it("should dismiss when the board scrolls or zooms", () => {
    const { result } = setup();
    act(() => result.current.focus(beta));
    act(() => {
      window.dispatchEvent(new Event("wheel"));
    });
    expect(result.current.peek).toBeNull();

    act(() => result.current.focus(beta));
    act(() => {
      window.dispatchEvent(new Event("scroll"));
    });
    expect(result.current.peek).toBeNull();
  });

  it("should open nothing when the resolver cannot describe the target", () => {
    const { result } = setup();
    act(() => result.current.focus({ kind: "card", id: "missing" }));
    expect(result.current.peek).toBeNull();
  });

  it("should clear a pending timer on unmount", () => {
    const { result, unmount } = setup();
    act(() => result.current.hover(alpha));
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
