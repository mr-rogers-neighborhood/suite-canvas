import { afterEach, describe, expect, it, vi } from "vitest";
import { escapeLayerCount, pushEscapeLayer } from "./escapeLayers";

const pressEscape = () => {
  const event = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
  window.dispatchEvent(event);
  return event;
};

const disposers: (() => void)[] = [];
const layer = (dismiss: () => void) => {
  const dispose = pushEscapeLayer(dismiss);
  disposers.push(dispose);
  return dispose;
};

afterEach(() => {
  while (disposers.length > 0) disposers.pop()?.();
});

describe("escape layers", () => {
  it("does nothing when no layer is open", () => {
    const event = pressEscape();
    expect(event.defaultPrevented).toBe(false);
  });

  it("closes the most recently opened layer only", () => {
    // Closing a layer is what unregisters it, so each dismiss in this test does
    // both — the shape a component's effect cleanup gives it.
    const opening = (dismiss: () => void) => {
      let dispose = () => {};
      dispose = layer(() => {
        dismiss();
        dispose();
      });
    };
    const outer = vi.fn();
    const inner = vi.fn();
    opening(outer);
    opening(inner);
    pressEscape();
    expect(inner).toHaveBeenCalledTimes(1);
    expect(outer).not.toHaveBeenCalled();
    pressEscape();
    expect(outer).toHaveBeenCalledTimes(1);
  });

  it("counts the layer only while it is open", () => {
    const dispose = layer(vi.fn());
    expect(escapeLayerCount()).toBe(1);
    dispose();
    expect(escapeLayerCount()).toBe(0);
  });

  it("keeps the key away from handlers below it", () => {
    const below = vi.fn();
    window.addEventListener("keydown", below);
    try {
      const dismiss = vi.fn();
      layer(dismiss);
      pressEscape();
      expect(dismiss).toHaveBeenCalledTimes(1);
      expect(below).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener("keydown", below);
    }
  });

  it("lets the key through once the last layer closes", () => {
    const below = vi.fn();
    const dispose = layer(vi.fn());
    dispose();
    window.addEventListener("keydown", below);
    try {
      pressEscape();
      expect(below).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener("keydown", below);
    }
  });
});
