export type CanvasSurface = "flow" | "scene" | "ice";

/**
 * The projected scene is the default surface. `?canvas=flow` keeps the old
 * single-board canvas reachable while parity is verified; `?canvas=ice`
 * loads the experimental engine spike. Unknown values fall back to scene.
 */
export function canvasSurfaceFromSearch(search: string): CanvasSurface {
  const value = new URLSearchParams(search).get("canvas");
  if (value === "flow" || value === "ice") return value;
  return "scene";
}

export function currentCanvasSurface(): CanvasSurface {
  return canvasSurfaceFromSearch(window.location.search);
}
