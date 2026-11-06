import { describe, expect, it } from "vitest";
import { documentFromArgv, documentFromLink } from "./documentLink.js";

const library = "/home/me/Documents/Suite/Canvas";
const present = () => true;
const canvasOnly = (path: string) => path.toLowerCase().endsWith(".canvas");
const argv = (...args: string[]) => ["/usr/bin/suite-canvas", ...args];

describe("documentFromLink", () => {
  it("resolves a link to the named document in the library", () => {
    expect(
      documentFromLink("suite://canvas/workspace/Research.canvas", library, canvasOnly, present),
    ).toBe(`${library}/Research.canvas`);
  });

  it("refuses a file that is not there", () => {
    expect(
      documentFromLink("suite://canvas/workspace/moved.canvas", library, canvasOnly, () => false),
    ).toBeNull();
  });

  it("refuses a name the app does not open", () => {
    expect(
      documentFromLink("suite://canvas/workspace/notes.txt", library, canvasOnly, present),
    ).toBeNull();
    expect(
      documentFromLink("suite://canvas/workspace/a/b.canvas", library, canvasOnly, present),
    ).toBeNull();
  });

  it("refuses a link that names another app", () => {
    expect(
      documentFromLink("suite://planner/workspace/x.planner", library, canvasOnly, present),
    ).toBeNull();
  });
});

describe("documentFromArgv", () => {
  it("reads a path the desktop handed over", () => {
    expect(documentFromArgv(argv("/tmp/x.canvas"), library, canvasOnly, present)).toBe(
      "/tmp/x.canvas",
    );
  });

  it("reads a link the hub routed here", () => {
    expect(
      documentFromArgv(argv("suite://canvas/workspace/B.canvas"), library, canvasOnly, present),
    ).toBe(`${library}/B.canvas`);
  });

  it("never treats a link as a path", () => {
    // A link ends in `.canvas` too, so the order of the two tests is the rule.
    expect(
      documentFromArgv(
        argv("suite://canvas/workspace/gone.canvas"),
        library,
        canvasOnly,
        () => false,
      ),
    ).toBeNull();
  });
});
