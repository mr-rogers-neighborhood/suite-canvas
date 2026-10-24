import { describe, expect, it } from "vitest";
import {
  createSuiteEdgeLabelLayer,
  edgeLabelRequestOf,
  SUITE_EDGE_LABEL_EVENT,
  type SuiteEdgeLabelAnchor,
} from "./suiteEdgeLabelLayer";

const CAMERA = { x: 0, y: 0, zoom: 2 };

function stage(anchors: readonly SuiteEdgeLabelAnchor[], camera = CAMERA) {
  const container = document.createElement("div");
  document.body.append(container);
  const layer = createSuiteEdgeLabelLayer({
    container,
    camera: () => camera,
    labels: () => anchors,
  });
  container.append(layer.layer);
  return { container, layer };
}

describe("createSuiteEdgeLabelLayer", () => {
  it("should draw one chip per described link at the projected point", () => {
    const { container, layer } = stage([
      { edgeId: "edge-1", label: "supports", point: { x: 50, y: 20 } },
      { edgeId: "edge-2", label: "contradicts", point: { x: 10, y: 60 } },
    ]);
    layer.sync();

    const chips = [...container.querySelectorAll<HTMLElement>("[data-testid='suite-edge-label']")];
    expect(chips).toHaveLength(2);
    expect(chips.map((chip) => chip.textContent)).toEqual(["supports", "contradicts"]);
    // World → screen: (point - camera) * zoom.
    expect(chips[0]?.style.left).toBe("100px");
    expect(chips[0]?.style.top).toBe("40px");
    expect(chips[1]?.dataset.edgeId).toBe("edge-2");
    expect(layer.count()).toBe(2);
    layer.dispose();
  });

  it("should draw nothing for an undescribed link", () => {
    const { layer } = stage([
      { edgeId: "edge-1", label: "", point: { x: 0, y: 0 } },
      { edgeId: "edge-2", label: "   ", point: { x: 0, y: 0 } },
    ]);
    layer.sync();
    expect(layer.count()).toBe(0);
    layer.dispose();
  });

  it("should move a chip and drop the ones whose link went away", () => {
    let anchors: readonly SuiteEdgeLabelAnchor[] = [
      { edgeId: "edge-1", label: "supports", point: { x: 0, y: 0 } },
      { edgeId: "edge-2", label: "older", point: { x: 0, y: 0 } },
    ];
    const container = document.createElement("div");
    document.body.append(container);
    const layer = createSuiteEdgeLabelLayer({
      container,
      camera: () => CAMERA,
      labels: () => anchors,
    });
    container.append(layer.layer);
    layer.sync();
    expect(layer.count()).toBe(2);

    anchors = [{ edgeId: "edge-1", label: "still supports", point: { x: 10, y: 10 } }];
    layer.sync();
    expect(layer.count()).toBe(1);
    const chip = container.querySelector<HTMLElement>("[data-testid='suite-edge-label']");
    expect(chip?.textContent).toBe("still supports");
    expect(chip?.style.left).toBe("20px");
    layer.dispose();
  });

  it("should draw nothing when the camera is not ready", () => {
    const container = document.createElement("div");
    document.body.append(container);
    const layer = createSuiteEdgeLabelLayer({
      container,
      camera: () => null,
      labels: () => [{ edgeId: "edge-1", label: "supports", point: { x: 1, y: 1 } }],
    });
    container.append(layer.layer);
    layer.sync();
    expect(layer.count()).toBe(0);
    layer.dispose();
  });

  it("should be inert, so a chip never swallows a press meant for the line", () => {
    const { layer } = stage([{ edgeId: "edge-1", label: "supports", point: { x: 0, y: 0 } }]);
    layer.sync();
    expect(layer.layer.style.pointerEvents).toBe("none");
    layer.dispose();
  });
});

describe("edgeLabelRequestOf", () => {
  const request = (detail: unknown) =>
    new CustomEvent(SUITE_EDGE_LABEL_EVENT, { detail, bubbles: true });

  it("should read a well-formed request", () => {
    expect(edgeLabelRequestOf(request({ edgeId: "edge-1", x: 4, y: 5 }))).toEqual({
      edgeId: "edge-1",
      x: 4,
      y: 5,
    });
  });

  it("should refuse anything that is not a request", () => {
    expect(edgeLabelRequestOf(new Event(SUITE_EDGE_LABEL_EVENT))).toBeNull();
    expect(edgeLabelRequestOf(request(null))).toBeNull();
    expect(edgeLabelRequestOf(request({ edgeId: "", x: 4, y: 5 }))).toBeNull();
    expect(edgeLabelRequestOf(request({ edgeId: "edge-1", x: Number.NaN, y: 5 }))).toBeNull();
    expect(edgeLabelRequestOf(request({ edgeId: "edge-1", x: "4", y: 5 }))).toBeNull();
  });
});
