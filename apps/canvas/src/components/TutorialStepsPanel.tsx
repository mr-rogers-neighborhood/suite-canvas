import {
  insertTourStep,
  listTourSteps,
  moveTourStep,
  removeTourStep,
  type StoredTourStep,
  type Target,
  type TourStepViewport,
  updateTourStep,
  type WorkspaceDocument,
} from "@suite/graph";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import type { ContainerID, LoroDoc } from "loro-crdt";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  completeTour,
  currentViewport,
  targetExistence,
  targetLabel,
  useArmTargetPick,
  useLoroVersion,
} from "../cards/tour";
import { useCanvasStore } from "../store/useCanvasStore";
import { useUiStore } from "../store/useUiStore";

export interface TutorialStepsPanelProps {
  /** The tutorial card whose body holds the steps. */
  cardId: string;
  /** The workspace document the body belongs to. */
  cardDoc: LoroDoc;
  /** Body container, or null before the card has one. */
  contentId: ContainerID | null;
  /** A share viewer reads the steps and plays the tour, and writes nothing. */
  canEdit?: boolean;
}

/** The tutorial's authoring surface (ADR-0058): Details · **Steps** · Style. */
export function TutorialStepsPanel({
  cardId,
  cardDoc,
  contentId,
  canEdit = true,
}: TutorialStepsPanelProps) {
  const workspace = useCanvasStore((state) => state.workspace);
  const version = useLoroVersion(cardDoc);
  const tour = useUiStore((state) => state.tour);
  const presentTour = useUiStore((state) => state.presentTour);
  const setTourStep = useUiStore((state) => state.setTourStep);
  const closeTour = useUiStore((state) => state.closeTour);

  // `contentId` is read so the panel re-derives once the first Add step creates
  // the body container; `version` is the subscription that sees every write.
  void contentId;

  const steps = useMemo(() => {
    // `version` is the change signal: the list is a pure read of the body.
    void version;
    return listTourSteps(workspace, cardId);
  }, [workspace, cardId, version]);
  const presentable = useMemo(() => steps.filter((stored) => stored.step !== null), [steps]);
  const presenting = tour?.tutorialId === cardId && tour.presenting;
  const current = presenting ? (tour?.stepIndex ?? 0) : 0;

  const [armed, setArmed] = useState(false);
  const cancelPick = useCallback(() => setArmed(false), []);
  const onPick = useCallback(
    (target: Target) => {
      setArmed(false);
      const viewport: TourStepViewport | null = currentViewport();
      // The anchor is a target *and* the camera the author was looking at: the
      // stored frame is what a reader sees once the target is gone.
      insertTourStep(workspace, cardId, {
        id: crypto.randomUUID(),
        targets: [target],
        ...(viewport ? { viewport } : {}),
        advance: "next",
      });
    },
    [workspace, cardId],
  );
  useArmTargetPick(armed, onPick, cancelPick);

  const currentStep = presentable[current]?.step ?? presentable[0]?.step ?? null;
  const currentStepId = presentable[current]?.stepId ?? presentable[0]?.stepId ?? null;

  const goNext = () => {
    if (current + 1 >= presentable.length) {
      completeTour(cardId);
      return;
    }
    setTourStep(current + 1);
  };

  return (
    <section className="tour-steps" data-testid="tutorial-steps">
      <div className="tour-steps__head">
        <span className="tour-steps__count" data-testid="tutorial-step-count">
          {steps.length === 1 ? "1 step" : `${steps.length} steps`}
        </span>
        <div className="tour-steps__head-actions">
          {canEdit ? (
            <button
              type="button"
              className="tour-steps__button"
              data-testid="tutorial-add-step"
              aria-pressed={armed}
              onClick={() => setArmed((open) => !open)}
            >
              {armed ? "Click a card or section…" : "Add step"}
            </button>
          ) : null}
          <button
            type="button"
            className="tour-steps__button is-primary"
            data-testid="tutorial-present"
            disabled={presentable.length === 0}
            onClick={() => (presenting ? closeTour() : presentTour(cardId, 0))}
          >
            {presenting ? "Stop" : "Present"}
          </button>
        </div>
      </div>

      {steps.length === 0 ? (
        <p className="tour-steps__empty" data-testid="tutorial-steps-empty">
          No steps yet. Add one and pick what it points at.
        </p>
      ) : (
        <ol className="tour-steps__list">
          {steps.map((stored, index) => (
            <StepRow
              key={stored.stepId ?? `step-${index}`}
              index={index}
              stored={stored}
              workspace={workspace}
              canEdit={canEdit}
              active={presenting && index === current}
              onFocus={() => setTourStep(index)}
              onMove={(direction) => moveTourStep(workspace, cardId, stored.stepId, direction)}
              onRemove={() => removeTourStep(workspace, cardId, stored.stepId)}
            />
          ))}
        </ol>
      )}

      {presenting && currentStep ? (
        <div className="tour-steps__present" data-testid="tutorial-presenting">
          <div className="tour-steps__transport">
            <button
              type="button"
              className="tour-steps__button"
              data-testid="tutorial-step-prev"
              disabled={current === 0}
              onClick={() => setTourStep(current - 1)}
            >
              Back
            </button>
            <span className="tour-steps__position" data-testid="tutorial-step-position">
              {current + 1} / {presentable.length}
            </span>
            <button
              type="button"
              className="tour-steps__button"
              data-testid="tutorial-step-next"
              onClick={goNext}
            >
              {current + 1 >= presentable.length ? "Finish" : "Next"}
            </button>
            <button
              type="button"
              className="tour-steps__button"
              data-testid="tutorial-step-exit"
              onClick={closeTour}
            >
              Exit
            </button>
          </div>
          <input
            type="range"
            className="tour-steps__scrubber"
            data-testid="tutorial-step-scrubber"
            aria-label="Step"
            min={0}
            max={Math.max(0, presentable.length - 1)}
            step={1}
            value={current}
            onChange={(event) => setTourStep(Number(event.target.value))}
          />
          <CaptionEditor
            stepId={currentStepId}
            caption={currentStep.caption ?? ""}
            canEdit={canEdit}
            onCommit={(caption) =>
              updateTourStep(workspace, cardId, currentStepId, {
                caption: caption.trim().length > 0 ? caption : null,
              })
            }
          />
        </div>
      ) : null}
    </section>
  );
}

function StepRow({
  index,
  stored,
  workspace,
  canEdit,
  active,
  onFocus,
  onMove,
  onRemove,
}: {
  index: number;
  stored: StoredTourStep;
  workspace: WorkspaceDocument;
  canEdit: boolean;
  active: boolean;
  onFocus: () => void;
  onMove: (direction: -1 | 1) => void;
  onRemove: () => void;
}) {
  const step = stored.step;
  const primary = step?.targets[0] ?? null;
  const dead = primary ? targetExistence(workspace)[primary.kind](primary.id) === false : false;
  const label = primary ? targetLabel(workspace, primary) : "No target yet";
  const extra = Math.max(0, (step?.targets.length ?? 0) - 1);

  return (
    <li
      className={`tour-steps__row${active ? " is-active" : ""}`}
      data-testid="tutorial-step-row"
      data-step-index={index}
      data-dead={dead ? "true" : undefined}
    >
      <button
        type="button"
        className="tour-steps__index"
        aria-label={`Go to step ${index + 1}`}
        onClick={onFocus}
      >
        {index + 1}
      </button>
      <div className="tour-steps__text">
        <p className="tour-steps__target">
          {label}
          {dead ? (
            <span className="tour-steps__dead" data-testid="tutorial-step-dead">
              removed
            </span>
          ) : null}
          {extra > 0 ? <span className="tour-steps__more">+{extra}</span> : null}
        </p>
        {step?.caption ? <p className="tour-steps__caption">{step.caption}</p> : null}
      </div>
      {canEdit ? (
        <div className="tour-steps__row-actions">
          <button
            type="button"
            className="tour-steps__icon"
            aria-label={`Move step ${index + 1} up`}
            onClick={() => onMove(-1)}
          >
            {"\u2191"}
          </button>
          <button
            type="button"
            className="tour-steps__icon"
            aria-label={`Move step ${index + 1} down`}
            onClick={() => onMove(1)}
          >
            {"\u2193"}
          </button>
          <button
            type="button"
            className="tour-steps__icon"
            aria-label={`Remove step ${index + 1}`}
            onClick={onRemove}
          >
            {"\u00d7"}
          </button>
        </div>
      ) : null}
    </li>
  );
}

/**
 * The caption in a real editor (ADR-0058 §2): an author writes a caption while
 * looking at the thing it describes, and a keystroke here must not move the
 * camera or the reading position. The stored value stays plain prose — the
 * step schema is a string — so the editor exists for the writing experience,
 * and committing is debounced into one write per pause.
 */
function CaptionEditor({
  stepId,
  caption,
  canEdit,
  onCommit,
}: {
  stepId: string | null;
  caption: string;
  canEdit: boolean;
  onCommit: (caption: string) => void;
}) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const commit = useRef(onCommit);
  commit.current = onCommit;

  const editor = useEditor(
    {
      extensions: [StarterKit.configure({ undoRedo: false })],
      content: caption ? `<p>${escapeHtml(caption)}</p>` : "",
      editable: canEdit,
      editorProps: {
        attributes: {
          class: "tour-steps__caption-editor",
          "aria-label": "Step caption",
          "data-testid": "tutorial-caption-editor",
        },
      },
      onUpdate: ({ editor: current }) => {
        if (timer.current !== null) clearTimeout(timer.current);
        timer.current = setTimeout(() => {
          timer.current = null;
          commit.current(current.getText().trim());
        }, 350);
      },
    },
    // One editor per step: a different step is different prose, not a reset.
    [stepId],
  );

  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );

  return <EditorContent editor={editor} />;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
