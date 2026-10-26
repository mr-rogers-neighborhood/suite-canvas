import type { StyleColourRole, StyleShape, SurfaceStyle, WorkspaceDocument } from "@suite/graph";
import { styleColourRoles, styleShapes } from "@suite/graph";
import { bulkStyleWrites, type StyledCardTarget, sharedStyleValue } from "./styleTargets";
import "./boardAffordances.css";

/**
 * The words the single-card Style tab uses, repeated here rather than imported
 * from `styles/surface/StyleTab`: the canvas must not depend on the inspector,
 * and a bulk edit showing different words for the same eight shapes would read
 * as a second style system.
 */
const SHAPE_WORDS: Record<StyleShape, string> = {
  rect: "Rectangle",
  pill: "Pill",
  diamond: "Diamond",
  parallelogram: "Parallelogram",
  circle: "Circle",
  document: "Document",
  database: "Database",
  hexagon: "Hexagon",
};

function roleWord(role: StyleColourRole): string {
  return role
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export interface BulkStyleBarProps {
  /** The selected cards and their own styles; fewer than two renders nothing. */
  targets: readonly StyledCardTarget[];
  canEdit: boolean;
  /** The document to write through; defaults to the live one. */
  workspace?: WorkspaceDocument | null;
}

/**
 * The bulk edit a multi-selection was missing.
 *
 * It patches each selected card's *own* style, one surface write per card, the
 * same record the single-card Style tab writes. Nothing here edits a rule; that
 * is the inspector's scope picker, and a bulk edit should not silently speak for
 * every card of a type as a side effect of moving three of them.
 */
export function BulkStyleBar({ targets, canEdit, workspace }: BulkStyleBarProps) {
  if (targets.length < 2) return null;
  const shape = sharedStyleValue(targets, "shape");
  const fill = sharedStyleValue(targets, "surface");

  const apply = (patch: SurfaceStyle) => {
    if (!canEdit || !workspace) return;
    for (const write of bulkStyleWrites(targets, patch)) {
      workspace.setCardStyle(write.cardId, write.style);
    }
  };

  const select = (value: string) => {
    if (value === "") apply({ surface: undefined });
    else if (value === "none") apply({ surface: "none" });
    else apply({ surface: value as StyleColourRole });
  };

  return (
    <div
      className="bulk-style-bar"
      data-testid="bulk-style-bar"
      role="toolbar"
      aria-label={`Style ${targets.length} cards`}
    >
      <span className="bulk-style-bar__label">{targets.length} cards</span>
      <div className="bulk-style-bar__chips" data-testid="bulk-style-shapes">
        <button
          type="button"
          className="bulk-style-chip"
          data-checked={!shape.mixed && shape.value === undefined ? "true" : undefined}
          data-mixed={shape.mixed ? "true" : undefined}
          data-testid="bulk-style-shape-default"
          disabled={!canEdit}
          onClick={() => apply({ shape: undefined })}
        >
          Default
        </button>
        {styleShapes.map((value) => (
          <button
            key={value}
            type="button"
            className="bulk-style-chip"
            data-checked={!shape.mixed && shape.value === value ? "true" : undefined}
            data-mixed={shape.mixed ? "true" : undefined}
            data-testid={`bulk-style-shape-${value}`}
            disabled={!canEdit}
            onClick={() => apply({ shape: value })}
          >
            {SHAPE_WORDS[value]}
          </button>
        ))}
      </div>
      <label className="bulk-style-bar__label">
        <select
          className="bulk-style-bar__select"
          data-testid="bulk-style-surface"
          aria-label="Fill colour"
          disabled={!canEdit}
          value={fill.mixed ? "mixed" : (fill.value ?? "")}
          onChange={(event) => select(event.target.value)}
        >
          {fill.mixed ? (
            <option value="mixed" disabled>
              Mixed
            </option>
          ) : null}
          <option value="">Default</option>
          <option value="none">None (bare)</option>
          {styleColourRoles.map((role) => (
            <option key={role} value={role}>
              {roleWord(role)}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
