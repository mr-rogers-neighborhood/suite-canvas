import type { View } from "@suite/graph";
import { describe, expect, it } from "vitest";

import { storedViewStanding } from "./iceEnteredPath";

function workspaceWith(view: View | undefined) {
  return {
    getView: () => view,
    hasStoredCamera: () => view?.cameraStored === true,
  };
}

const VIEW = {
  id: "view-1",
  name: "Atlas",
  camera: { x: 120, y: -48, zoom: 0.8 },
  cameraStored: true,
  path: ["board-research"],
  returnCamera: { x: 12, y: 34, zoom: 1.25 },
  createdAt: 1,
  updatedAt: 2,
} satisfies View;

describe("stored View standing", () => {
  it("should pick the stored camera over the fit", () => {
    expect(storedViewStanding(workspaceWith(VIEW), VIEW.id)).toEqual({
      camera: { x: 120, y: -48, zoom: 0.8 },
      path: ["board-research"],
      returnCamera: { x: 12, y: 34, zoom: 1.25 },
    });
  });

  it("should fit a View that has never moved", () => {
    expect(storedViewStanding(workspaceWith({ ...VIEW, cameraStored: false }), VIEW.id)).toBeNull();
  });

  it("should read a View with no entered Board as the plane", () => {
    expect(storedViewStanding(workspaceWith({ ...VIEW, path: undefined }), VIEW.id)).toEqual({
      camera: VIEW.camera,
      path: [],
      returnCamera: VIEW.returnCamera,
    });
  });

  it("should fit rather than restore a camera the desk cannot stand in", () => {
    const broken: View = { ...VIEW, camera: { x: 0, y: 0, zoom: 0 } };
    expect(storedViewStanding(workspaceWith(broken), VIEW.id)).toBeNull();
  });

  it("should answer null when there is no View to stand in", () => {
    expect(storedViewStanding(workspaceWith(undefined), VIEW.id)).toBeNull();
    expect(storedViewStanding(workspaceWith(VIEW), null)).toBeNull();
  });
});
