export type CanvasSurface = "flow" | "scene";

/**
 * The scene surface is opt-in while it reaches parity: `?canvas=scene` uses the
 * projected scene on React Flow. Anything else keeps the editing canvas.
 */
export function canvasSurfaceFromSearch(search: string): CanvasSurface {
  const value = new URLSearchParams(search).get("canvas");
  if (value === "scene") return value;
  return "flow";
}

export function currentCanvasSurface(): CanvasSurface {
  return canvasSurfaceFromSearch(window.location.search);
}
