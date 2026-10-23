import { describe, expect, it } from "vitest";
import { canvasSurfaceFromSearch } from "./surfaceFlag";

describe("canvasSurfaceFromSearch", () => {
  it("should keep the existing canvas as the default", () => {
    expect(canvasSurfaceFromSearch("")).toBe("flow");
    expect(canvasSurfaceFromSearch("?workspace=abc")).toBe("flow");
    expect(canvasSurfaceFromSearch("?canvas=unknown")).toBe("flow");
  });

  it("should opt into the projected scene or the ICE spike", () => {
    expect(canvasSurfaceFromSearch("?canvas=scene")).toBe("scene");
    expect(canvasSurfaceFromSearch("?workspace=abc&canvas=ice")).toBe("ice");
  });
});
