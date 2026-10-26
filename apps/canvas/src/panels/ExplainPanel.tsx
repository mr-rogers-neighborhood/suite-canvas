import { useMemo } from "react";
import { type ExplainContext, explainContext } from "../canvas/explainContext";
import { useCardTitles } from "../hooks/useReferenceCounts";
import { useUiStore } from "../store/useUiStore";
import { useWorkspaceSnapshot } from "../store/workspaceStore";

export interface ExplainPanelProps {
  /** Defaults to the live selection and document; tests inject their own. */
  context?: ExplainContext | undefined;
}

/**
 * The surface `explain` needs to be a mode rather than a colour
 * (ADR-0066 §4).
 *
 * It gathers the selection — the entities, their types, their fields, the links between
 * them — and stops there: nothing is written, and the context is UI state. That is the
 * whole of the first half; answering from the handbook is gate A41, and saving a context
 * as a view is ADR-0043's work. The footer says so once, because a panel with no Save
 * button reads as a bug otherwise.
 *
 * It is deliberately *not* an inspector: the inspector is about one thing and this is
 * about a set, which is why it stands on its own and disappears with the purpose.
 */
export function ExplainPanel({ context }: ExplainPanelProps) {
  const purpose = useUiStore((state) => state.purpose);
  const selectedIds = useUiStore((state) => state.selectedNodeIds);
  const snapshot = useWorkspaceSnapshot();
  const titles = useCardTitles();

  const live = useMemo(
    () =>
      explainContext({
        selectedIds,
        cards: snapshot.cards,
        sections: snapshot.sections,
        edges: snapshot.edges,
        titles: new Map(titles.map((entry) => [entry.id, entry.title])),
        typeNames: new Map(snapshot.types.map((type) => [type.id, type.name])),
      }),
    [selectedIds, snapshot, titles],
  );

  if (purpose !== "explain") return null;
  const model = context ?? live;

  return (
    <aside
      className="explain-panel"
      data-testid="explain-panel"
      aria-label="Context"
      // The canvas claims pointerdown for panning and selection; a panel over it has to
      // say that a press here is not a press on the canvas.
      onPointerDown={(event) => event.stopPropagation()}
    >
      <header className="explain-panel__header">
        <span className="explain-panel__glyph" aria-hidden="true">
          {"\u25c8"}
        </span>
        <span className="explain-panel__count" data-testid="explain-count">
          {model.entities.length === 0
            ? "Nothing selected"
            : `${model.entities.length} ${model.entities.length === 1 ? "thing" : "things"}`}
          {model.links.length > 0
            ? ` · ${model.links.length} ${model.links.length === 1 ? "link" : "links"}`
            : ""}
        </span>
      </header>

      {model.entities.length === 0 ? (
        <p className="explain-panel__empty" data-testid="explain-empty">
          Select cards to gather a context.
        </p>
      ) : (
        <>
          <ul className="explain-panel__entities" data-testid="explain-entities">
            {model.entities.map((entity) => (
              <li key={entity.id} className="explain-panel__entity" data-testid="explain-entity">
                <span className="explain-panel__title">{entity.title}</span>
                <span className="explain-panel__kind" data-testid="explain-kind">
                  {entity.kind}
                </span>
                {entity.fields.length > 0 ? (
                  <dl className="explain-panel__fields">
                    {entity.fields.map((field) => (
                      <div key={`${entity.id}:${field.label}`} className="explain-panel__field">
                        <dt>{field.label}</dt>
                        <dd>{field.value}</dd>
                      </div>
                    ))}
                  </dl>
                ) : null}
              </li>
            ))}
          </ul>

          {model.links.length > 0 ? (
            <ul className="explain-panel__links" data-testid="explain-links">
              {model.links.map((link) => (
                <li key={link.id} className="explain-panel__link" data-testid="explain-link">
                  <span className="explain-panel__link-ends">
                    {link.from} → {link.to}
                  </span>
                  <span className="explain-panel__kind">{link.kind}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </>
      )}

      {model.partial ? (
        <p className="explain-panel__note" data-testid="explain-partial">
          Some of the selection cannot be explained — a board or a deleted card.
        </p>
      ) : null}

      <p className="explain-panel__note" data-testid="explain-footer">
        Read-only: the context is what you selected. Saving it as a view is its own gate.
      </p>
    </aside>
  );
}
