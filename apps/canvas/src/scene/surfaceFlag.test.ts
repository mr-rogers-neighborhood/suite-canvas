import { describe, expect, it } from "vitest";
import { canvasSurfaceFromSearch } from "./surfaceFlag";

describe("canvasSurfaceFromSearch", () => {
  it("should use the projected scene as the default", () => {
    expect(canvasSurfaceFromSearch("")).toBe("scene");
    expect(canvasSurfaceFromSearch("?workspace=abc")).toBe("scene");
    expect(canvasSurfaceFromSearch("?canvas=unknown")).toBe("scene");
  });

  it("should explicitly select the legacy canvas or the ICE spike", () => {
    expect(canvasSurfaceFromSearch("?canvas=scene")).toBe("scene");
    expect(canvasSurfaceFromSearch("?workspace=abc&canvas=ice")).toBe("ice");
  });
});
