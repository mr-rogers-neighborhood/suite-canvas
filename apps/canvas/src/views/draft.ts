import {
  emptyViewQuery,
  type SavedView,
  type ViewCollection,
  type ViewKind,
  type ViewLens,
  type ViewQuery,
  type ViewRender,
  viewKindOf,
} from "@suite/graph";

/**
 * A view being edited, before it is anything.
 *
 * The sheet edits this, and the board reads it through `draftToView`: a draft is a `SavedView` with a
 * temporary id, so the lens, the figures and the presentation all work on it without learning that
 * drafts exist. That is the whole trick of the live preview — nothing new renders, it just renders a
 * view that has not been written yet.
 */
export interface ViewDraft {
  /** The saved view this draft edits, or null for a view that has never been saved. */
  readonly sourceId: string | null;
  readonly name: string;
  readonly query: ViewQuery;
  /** Cards pulled in by hand, beside the query's rule. */
  readonly cardIds: readonly string[];
  readonly kind: ViewKind;
  readonly lens: ViewLens;
  readonly collection: ViewCollection;
  readonly render: ViewRender;
}

/** The id a draft wears until it is saved, so no consumer mistakes it for a stored view. */
export const PREVIEW_VIEW_ID = "preview";

export function emptyDraft(count: number): ViewDraft {
  return {
    sourceId: null,
    name: `View ${String(count + 1)}`,
    query: emptyViewQuery(),
    cardIds: [],
    kind: "lens",
    lens: {},
    collection: { mode: "database" },
    render: { layout: "graph-2d", measure: { of: "count" } },
  };
}

/** The draft that edits a saved view, keeping everything the schema holds. */
export function draftFromView(view: SavedView): ViewDraft {
  return {
    sourceId: view.id,
    name: view.name,
    query: view.query,
    cardIds: view.context?.cardIds ?? [],
    kind: viewKindOf(view),
    lens: view.lens ?? {},
    collection: view.collection ?? { mode: "database" },
    render: view.render ?? { layout: "graph-2d", measure: { of: "count" } },
  };
}

/**
 * The draft as a view.
 *
 * A new draft takes the preview id; an edited one keeps its own, so the board shows the draft's
 * result under the name the reader typed rather than under whatever was applied before.
 */
export function draftToView(draft: ViewDraft, position = 0): SavedView {
  return {
    id: draft.sourceId ?? PREVIEW_VIEW_ID,
    name: draft.name.trim().length === 0 ? "Untitled view" : draft.name,
    position,
    query: draft.query,
    ...(draft.cardIds.length === 0 ? {} : { context: { cardIds: [...draft.cardIds] } }),
    kind: draft.kind,
    // A lens is a selection now: only a preferred board is worth storing, and only when one was
    // chosen. Nothing writes a camera any more.
    ...(draft.kind === "lens" ? { lens: draft.lens } : {}),
    ...(draft.kind === "collection" ? { collection: draft.collection } : {}),
    ...(draft.kind === "render" ? { render: draft.render } : {}),
  };
}

/**
 * Whether the draft would change anything.
 *
 * Both sides are pushed through `draftToView` before they are compared, so a default that
 * materialises in the editor (a render's measure, a lens with no board) is not mistaken for an edit,
 * and a field the kind does not use is not compared at all.
 */
export function draftIsDirty(draft: ViewDraft, saved: SavedView | undefined): boolean {
  const next = draftToView(draft, saved?.position ?? 0);
  const baseline =
    saved === undefined
      ? draftToView({ ...draft, name: "", cardIds: [], query: emptyViewQuery(), kind: "lens" })
      : draftToView(draftFromView(saved), saved.position);
  return JSON.stringify(next) !== JSON.stringify(baseline);
}
