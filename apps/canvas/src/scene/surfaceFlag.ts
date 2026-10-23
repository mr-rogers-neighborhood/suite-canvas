export type CanvasSurface = "flow" | "scene" | "ice";

/**
 * The new surfaces are opt-in while they reach parity. `?canvas=scene` uses
 * the projected scene on React Flow; `?canvas=ice` is the spike surface.
 * Anything else keeps the existing canvas.
 */
export function canvasSurfaceFromSearch(search: string): CanvasSurface {
  const value = new URLSearchParams(search).get("canvas");
  if (value === "scene" || value === "ice") return value;
  return "flow";
}

export function currentCanvasSurface(): CanvasSurface {
  return canvasSurfaceFromSearch(window.location.search);
}
