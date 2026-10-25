import {
  primaryTarget,
  type Target,
  TOUR_STEP_NODE_NAME,
  type TourStepAdvance,
  type TourStepAttributes,
} from "@suite/graph";
import type { Node as PMNode } from "@tiptap/pm/model";
import { type NodeViewProps, NodeViewWrapper } from "@tiptap/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { currentViewport, useArmTargetPick, useTargetLabel } from "../cards/tour";
import { useUiStore } from "../store/useUiStore";
import type { TourStepOptions } from "./TourStep";
import { stepOfAttributes } from "./TourStep";

/**
 * Where this block sits in the document. `getPos` throws while the node view is
 * still being attached, so the position is read in an effect — after every
 * render, which is also how a shift caused by an earlier block lands here.
 */
function useNodePosition(getPos: () => number | undefined): number | null {
  const [position, setPosition] = useState<number | null>(null);
  useEffect(() => {
    let next: number | null = null;
    try {
      const value = getPos();
      next = typeof value === "number" ? value : null;
    } catch {
      next = null;
    }
    setPosition((current) => (current === next ? current : next));
  });
  return position;
}

/** The index of the step block at `position`, counting only step blocks. */
function stepIndexAt(doc: PMNode, position: number): number {
  let index = -1;
  let seen = 0;
  doc.descendants((candidate: PMNode, at: number) => {
    if (candidate.type.name !== TOUR_STEP_NODE_NAME) return true;
    if (at === position) index = seen;
    seen += 1;
    return true;
  });
  return index;
}

/**
 * The block a tour author sees in a tutorial's body.
 *
 * Static on purpose: an index, the target it points at, the caption as plain
 * authored prose, and the two actions that are about this one stop (present
 * from here, remove it). Everything that arranges steps lives in the card's
 * Steps panel; this is the document's own view of itself.
 */
export function TourStepView({
  node,
  editor,
  getPos,
  updateAttributes,
  deleteNode,
  extension,
}: NodeViewProps) {
  const { cardId } = extension.options as TourStepOptions;
  const attributes = node.attrs as TourStepAttributes;
  const step = stepOfAttributes(attributes);
  const targets = step?.targets ?? [];
  const primary: Target | null = step ? primaryTarget(step) : null;
  const label = useTargetLabel(primary);
  const caption = typeof attributes.caption === "string" ? attributes.caption : "";
  const advance: TourStepAdvance = attributes.advance ?? "next";

  const position = useNodePosition(getPos);
  const stepIndex = position === null ? -1 : stepIndexAt(editor.state.doc, position);

  const [armed, setArmed] = useState(false);
  const cancelPick = useCallback(() => setArmed(false), []);
  const onPick = useCallback(
    (target: Target) => {
      setArmed(false);
      // The viewport is captured with the target: the anchor is both, and the
      // stored frame is what a reader sees once the target is gone.
      updateAttributes({ targets: [target], viewport: currentViewport() });
    },
    [updateAttributes],
  );
  useArmTargetPick(armed, onPick, cancelPick);

  const captionRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const element = captionRef.current;
    if (!element) return;
    // A peer's edit (or a panel edit) lands here; the reader's own keystrokes
    // must not be overwritten while they type.
    if (element.contains(document.activeElement)) return;
    if (element.textContent !== caption) element.textContent = caption;
  }, [caption]);

  const extraTargets = targets.length - 1;
  const present = useMemo(
    () => () => useUiStore.getState().presentTour(cardId, Math.max(0, stepIndex)),
    [cardId, stepIndex],
  );

  return (
    <NodeViewWrapper
      as="div"
      className="tour-step"
      data-testid="tour-step-block"
      data-step-index={stepIndex >= 0 ? stepIndex : undefined}
      data-armed={armed ? "true" : undefined}
      role="group"
      aria-label={stepIndex >= 0 ? `Tour step ${stepIndex + 1}` : "Tour step"}
    >
      <span className="tour-step__index" aria-hidden="true">
        {stepIndex >= 0 ? stepIndex + 1 : "\u2022"}
      </span>
      <div className="tour-step__main">
        {primary ? (
          <p className="tour-step__target" data-testid="tour-step-target">
            <span className="tour-step__kind">{primary.kind}</span>
            <span className="tour-step__label">{label}</span>
            {extraTargets > 0 ? (
              <span className="tour-step__more">+{extraTargets} more</span>
            ) : null}
          </p>
        ) : (
          <button
            type="button"
            className="tour-step__pick"
            data-testid="tour-step-pick-target"
            aria-pressed={armed}
            onClick={() => setArmed((current) => !current)}
          >
            {armed ? "Click a card or section…" : "Choose target"}
          </button>
        )}
        {/* biome-ignore lint/a11y/useSemanticElements: the caption is inline prose; a textarea would own a line and a value of its own. */}
        <div
          ref={captionRef}
          className="tour-step__caption"
          data-testid="tour-step-caption"
          contentEditable
          suppressContentEditableWarning
          role="textbox"
          tabIndex={0}
          aria-label="Step caption"
          aria-multiline="false"
          data-placeholder="Say what this step means"
          onBlur={(event) => {
            const text = event.currentTarget.textContent?.trim() ?? "";
            if (text === caption) return;
            updateAttributes({ caption: text.length > 0 ? text : null });
          }}
          onKeyDown={(event) => {
            // One line of prose: Enter commits instead of splitting the block.
            if (event.key === "Enter") {
              event.preventDefault();
              event.currentTarget.blur();
            }
          }}
        />
      </div>
      <div className="tour-step__actions">
        <button
          type="button"
          className="tour-step__advance"
          data-testid="tour-step-advance"
          aria-label={`Advance on ${advance}`}
          onClick={() => updateAttributes({ advance: advance === "click" ? "next" : "click" })}
        >
          advance: {advance}
        </button>
        <button
          type="button"
          className="tour-step__action"
          data-testid="tour-step-present"
          onClick={present}
        >
          Play
        </button>
        <button
          type="button"
          className="tour-step__action"
          data-testid="tour-step-remove"
          onClick={() => deleteNode()}
        >
          Remove
        </button>
      </div>
    </NodeViewWrapper>
  );
}
