import { describe, expect, it } from "vitest";
import { iconBody, preloadIconSet } from "./iconSets";

describe("the bundled icon sets", () => {
  it("should resolve a reference to the set's own markup", async () => {
    await preloadIconSet("lucide");
    const body = iconBody("lucide:check");
    expect(body).not.toBeNull();
    expect(body?.body).toContain("<path");
    expect(body?.width).toBeGreaterThan(0);
  });

  it("should answer nothing for an unknown set or an unknown name", async () => {
    await preloadIconSet("lucide");
    expect(iconBody("nosuchset:check")).toBeNull();
    expect(iconBody("lucide:no-such-icon-name")).toBeNull();
  });

  it("should answer nothing for a value that is not a reference", () => {
    for (const value of [null, undefined, "", "check", ":check", "lucide:"]) {
      expect(iconBody(value)).toBeNull();
    }
  });
});
