import {
  emptyViewQuery,
  type SavedView,
  type ViewCollection,
  type ViewKind,
  type ViewQuery,
  type ViewRender,
} from "@suite/graph";

/**
 * A *new* view, before it exists.
 *
 * A saved view is edited in the document itself, so this is only ever the starting point of a view that has
 * never been created: a name, an empty context, and the defaults a collection or a render needs. Its first
 * `Create` turns it into a record, and from then on everyone sees the same thing.
 */
export interface ViewDraft {
  readonly name: string;
  readonly query: ViewQuery;
  /** Cards pinned by hand, beside the query's rule. */
  readonly cardIds: readonly string[];
  readonly kind: ViewKind;
  readonly collection: ViewCollection;
  readonly render: ViewRender;
}

/** The id a draft wears while it is being previewed on the board. */
export const PREVIEW_VIEW_ID = "preview";

export function emptyDraft(count: number): ViewDraft {
  return {
    name: `View ${String(count + 1)}`,
    query: emptyViewQuery(),
    cardIds: [],
    kind: "collection",
    collection: { mode: "database" },
    render: { layout: "graph-2d", measure: { of: "count" } },
  };
}

/** The draft as a view, for the projection preview and the rail. */
export function draftToView(draft: ViewDraft, position = 0): SavedView {
  return {
    id: PREVIEW_VIEW_ID,
    name: draft.name.trim().length === 0 ? "Untitled view" : draft.name,
    position,
    query: draft.query,
    ...(draft.cardIds.length === 0 ? {} : { context: { cardIds: [...draft.cardIds] } }),
    kind: draft.kind,
    ...(draft.kind === "collection" ? { collection: draft.collection } : {}),
    ...(draft.kind === "render" ? { render: draft.render } : {}),
  };
}
