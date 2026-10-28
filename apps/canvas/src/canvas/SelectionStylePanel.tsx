import type { WorkspaceDocument } from "@suite/graph";
import { useMemo } from "react";
import { StyleTab } from "../styles/surface/StyleTab";
import type { StyleTarget } from "../styles/surface/useStyleDraft";
import "./boardAffordances.css";

export interface SelectionStylePanelProps {
  /** The selected cards. Fewer than two renders nothing: one card has its inspector. */
  cardIds: readonly string[];
  canEdit: boolean;
  /** The document to write through; defaults to the live one. */
  workspace?: WorkspaceDocument | null;
}

/**
 * The style editor a multi-selection gets: the inspector's own tab, docked on the canvas.
 *
 * It used to be a separate bar with its own vocabulary — surface *roles* where the
 * inspector offers palette swatches, one outline where the inspector offers four sides.
 * Two editors for one record drift, and the drift is what the reports were about. This
 * is the same component the inspector mounts, so it cannot offer something the
 * inspector does not, and a value the selection disagrees about reads Mixed in the one
 * place that owns the key.
 */
export function SelectionStylePanel({
  cardIds,
  canEdit,
  workspace = null,
}: SelectionStylePanelProps) {
  const targets = useMemo<StyleTarget[]>(
    () => cardIds.map((id) => ({ kind: "card" as const, id })),
    [cardIds],
  );
  if (targets.length < 2) return null;

  return (
    // biome-ignore lint/a11y/useSemanticElements: a floating panel of controls over the canvas, not a form; a fieldset brings form layout defaults to an overlay
    <div
      className="selection-style"
      data-testid="selection-style"
      role="group"
      aria-label={`Style ${targets.length} cards`}
    >
      <span className="selection-style__label">{`${targets.length} cards`}</span>
      <StyleTab targets={targets} canEdit={canEdit} workspace={workspace} />
    </div>
  );
}
