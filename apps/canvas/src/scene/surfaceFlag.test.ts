import { describe, expect, it } from "vitest";
import { canvasSurfaceFromSearch } from "./surfaceFlag";

describe("canvasSurfaceFromSearch", () => {
  it("should keep the existing canvas as the default", () => {
    expect(canvasSurfaceFromSearch("")).toBe("flow");
    expect(canvasSurfaceFromSearch("?workspace=abc")).toBe("flow");
    expect(canvasSurfaceFromSearch("?canvas=unknown")).toBe("flow");
  });

  it("should opt into the projected scene", () => {
    expect(canvasSurfaceFromSearch("?canvas=scene")).toBe("scene");
    expect(canvasSurfaceFromSearch("?workspace=abc&canvas=scene")).toBe("scene");
  });

  it("should ignore a surface flag that no longer exists", () => {
    expect(canvasSurfaceFromSearch("?canvas=ice")).toBe("flow");
  });
});
