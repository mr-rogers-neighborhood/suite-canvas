import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PortalCard } from "./PortalCard";
import { boardMiniature } from "./portalMiniature";

const model = boardMiniature([], []);

function portal(style?: Parameters<typeof PortalCard>[0]["style"]) {
  return render(<PortalCard boardName="Research" glyph={"\u25c9"} model={model} style={style} />);
}

// jsdom drops custom properties from an inline style, so these assertions stop
// at the class and the data attribute the paint CSS keys off; the values
// themselves are covered by surfacePaint.test.ts.
describe("PortalCard paint", () => {
  it("marks a portal that names a style as painted", () => {
    portal({ surface: "ink", shape: "pill", opacity: 0.5, textScale: 1.5 });

    expect(screen.getByTestId("portal-node").className).toContain("is-painted");
  });

  it("leaves an unstyled portal exactly as it was", () => {
    portal();
    const node = screen.getByTestId("portal-node");

    expect(node.className).not.toContain("is-painted");
    expect(node.getAttribute("data-seamless")).toBeNull();
  });

  it("marks a seamless portal so its frame lets the miniature sit on the canvas", () => {
    portal({ surface: "none" });
    const node = screen.getByTestId("portal-node");

    expect(node.getAttribute("data-seamless")).toBe("true");
    expect(node.className).toContain("is-painted");
  });
});
