import { describe, expect, it } from "vitest";
import { domFaceRequested } from "./suitePen";

describe("the DOM face is asked for, not compiled in", () => {
  it("answers only for the explicit flag", () => {
    expect(domFaceRequested("?face=dom")).toBe(true);
    expect(domFaceRequested("?workspace=w&face=dom")).toBe(true);
    expect(domFaceRequested("face=dom")).toBe(true);
  });

  it("leaves the sheet alone otherwise", () => {
    expect(domFaceRequested("")).toBe(false);
    expect(domFaceRequested("?fresh=1")).toBe(false);
    expect(domFaceRequested("?face=sheet")).toBe(false);
    expect(domFaceRequested("?face=")).toBe(false);
  });
});
