import type { SavedView } from "@suite/graph";
import { describe, expect, it } from "vitest";
import { draftFromView, draftIsDirty, draftToView, emptyDraft, PREVIEW_VIEW_ID } from "./draft";

const saved: SavedView = {
  id: "v1",
  name: "Grading pass",
  position: 2,
  query: {
    typeIds: ["note"],
    tagIds: [],
    sectionIds: [],
    scope: "all",
    groupBySection: false,
    order: "title",
  },
  kind: "collection",
  collection: { mode: "grid" },
};

describe("a view draft", () => {
  it("should round-trip a saved view without changing it", () => {
    expect(draftToView(draftFromView(saved), saved.position)).toEqual(saved);
  });

  it("should wear the preview id until it is saved", () => {
    const draft = emptyDraft(0);
    expect(draftToView(draft).id).toBe(PREVIEW_VIEW_ID);

    // An edited view keeps its own id, so the board shows the draft under the name on screen.
    expect(draftToView(draftFromView(saved)).id).toBe("v1");
  });

  it("should write only the presentation its kind uses", () => {
    const draft = { ...emptyDraft(0), kind: "render" as const };
    const view = draftToView(draft);

    expect(view.kind).toBe("render");
    expect(view.render).toEqual({ layout: "graph-2d", measure: { of: "count" } });
    // A render is not a lens and not a collection: a half-filled payload per kind is how two
    // presenters end up disagreeing about which one is current.
    expect(view.lens).toBeUndefined();
    expect(view.collection).toBeUndefined();
  });

  it("should not write an empty pin list", () => {
    expect(draftToView(emptyDraft(0)).context).toBeUndefined();
    expect(draftToView({ ...emptyDraft(0), cardIds: ["c1"] }).context).toEqual({
      cardIds: ["c1"],
    });
  });

  it("should name an unnamed draft rather than storing an empty name", () => {
    expect(draftToView({ ...emptyDraft(0), name: "   " }).name).toBe("Untitled view");
  });

  it("should not be dirty when nothing changed, even though defaults were filled in", () => {
    // Reopening a saved view fills in a render payload and a lens payload it never had.
    expect(draftIsDirty(draftFromView(saved), saved)).toBe(false);
  });

  it("should be dirty when a query, a pin or a kind changes", () => {
    const base = draftFromView(saved);
    expect(draftIsDirty({ ...base, name: "Other" }, saved)).toBe(true);
    expect(draftIsDirty({ ...base, kind: "render" }, saved)).toBe(true);
    expect(draftIsDirty({ ...base, cardIds: ["c1"] }, saved)).toBe(true);
    expect(draftIsDirty({ ...base, query: { ...base.query, text: "timeline" } }, saved)).toBe(true);
  });

  it("should treat a brand-new empty draft as clean, so Save can be enabled deliberately", () => {
    const blank = { ...emptyDraft(0), name: "" };
    expect(draftIsDirty(blank, undefined)).toBe(false);
    expect(draftIsDirty({ ...blank, name: "Mine" }, undefined)).toBe(true);
  });
});
