import type {
  StyleColourRole,
  StyleEdgePaint,
  StyleShape,
  SurfaceStyle,
  WorkspaceDocument,
} from "@suite/graph";
import {
  DEFAULT_LABEL,
  FILL_OPTIONS,
  PAINT_OPTIONS,
  SHAPE_OPTIONS,
  styleRowsFor,
} from "../styles/styleOptions";
import { bulkStyleWrites, type StyledCardTarget, sharedStyleValue } from "./styleTargets";
import "./boardAffordances.css";

export interface BulkStyleBarProps {
  /** The selected cards and their own styles; fewer than two renders nothing. */
  targets: readonly StyledCardTarget[];
  canEdit: boolean;
  /** The document to write through; defaults to the live one. */
  workspace?: WorkspaceDocument | null;
}

/** One row's worth of control state, whatever key it writes. */
interface RowControl {
  testId: string;
  mixed: boolean;
  options: readonly { value: string | undefined; label: string }[];
  current: string | undefined;
  apply: (value: string | undefined) => void;
}

/**
 * The bulk edit a multi-selection was missing.
 *
 * It patches each selected card's *own* style, one surface write per card, the
 * same record the single-card Style tab writes. Nothing here edits a rule; that
 * is the inspector's scope picker, and a bulk edit should not silently speak for
 * every card of a type as a side effect of moving three of them.
 *
 * The rows, their choices and their words come from `styles/styleOptions` — the
 * table the inspector renders — so a bulk edit cannot offer "Rectangle" beside an
 * inspector offering something else. A row the whole selection cannot hold is not
 * rendered at all, which is what makes a mixed selection read honestly.
 */
export function BulkStyleBar({ targets, canEdit, workspace }: BulkStyleBarProps) {
  if (targets.length < 2) return null;

  const apply = (patch: SurfaceStyle) => {
    if (!canEdit || !workspace) return;
    for (const write of bulkStyleWrites(targets, patch)) {
      workspace.setCardStyle(write.cardId, write.style);
    }
  };

  /**
   * The outline a shaped card wears is one paint for every side, which is the same
   * record the inspector's single `Outline` row writes: a diamond has no top edge
   * to style apart from its bottom one.
   */
  const outlinePaint = (paint: StyleEdgePaint): NonNullable<SurfaceStyle["sides"]> => ({
    top: { paint },
    right: { paint },
    bottom: { paint },
    left: { paint },
  });

  const control = (id: ReturnType<typeof styleRowsFor>[number]["id"]): RowControl | null => {
    if (id === "shape") {
      const shared = sharedStyleValue(targets, "shape");
      return {
        testId: "bulk-style-shape",
        mixed: shared.mixed,
        options: SHAPE_OPTIONS,
        current: shared.value,
        apply: (value) => apply({ shape: value as StyleShape | undefined }),
      };
    }
    if (id === "fill") {
      const shared = sharedStyleValue(targets, "surface");
      return {
        testId: "bulk-style-surface",
        mixed: shared.mixed,
        options: FILL_OPTIONS,
        current: shared.value,
        apply: (value) => apply({ surface: value as StyleColourRole | "none" | undefined }),
      };
    }
    if (id === "outline") {
      const shared = sharedStyleValue(targets, "sides");
      const paint = shared.mixed ? undefined : (shared.value?.top?.paint ?? "solid");
      return {
        testId: "bulk-style-outline",
        mixed: shared.mixed,
        options: PAINT_OPTIONS.map((option) => ({ ...option, value: option.value ?? "solid" })),
        current: paint,
        apply: (value) => {
          const next = (value ?? "solid") as StyleEdgePaint;
          apply({ sides: outlinePaint(next) });
        },
      };
    }
    return null;
  };

  return (
    <div
      className="bulk-style-bar"
      data-testid="bulk-style-bar"
      role="toolbar"
      aria-label={`Style ${targets.length} cards`}
    >
      <span className="bulk-style-bar__label">{targets.length} cards</span>
      {styleRowsFor("card").map((row) => {
        const row_control = control(row.id);
        if (!row_control) return null;
        return (
          <fieldset
            key={row.id}
            className="bulk-style-bar__chips"
            data-testid={row_control.testId}
            aria-label={row.label}
          >
            {row_control.options.map((option) => (
              <button
                key={option.label}
                type="button"
                className="bulk-style-chip"
                data-checked={
                  !row_control.mixed && row_control.current === option.value ? "true" : undefined
                }
                data-mixed={row_control.mixed ? "true" : undefined}
                data-testid={`${row_control.testId}-${option.value ?? "default"}`}
                disabled={!canEdit}
                onClick={() => row_control.apply(option.value)}
              >
                {option.label === DEFAULT_LABEL ? DEFAULT_LABEL : option.label}
              </button>
            ))}
          </fieldset>
        );
      })}
    </div>
  );
}
