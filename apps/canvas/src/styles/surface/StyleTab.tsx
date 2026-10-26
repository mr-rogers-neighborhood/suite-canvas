import type {
  StyleColourRole,
  StyleEdgeFlow,
  StyleEdgePaint,
  StyleShape,
  StyleSide,
  SurfaceStyle,
  WorkspaceDocument,
} from "@suite/graph";
import {
  isEmptyStyle,
  styleColourRoles,
  styleEdgeFlows,
  styleEdgePaints,
  styleShapes,
  styleSides,
  TEXT_SCALE_MAX,
  TEXT_SCALE_MIN,
} from "@suite/graph";
import { useState } from "react";
import { cardsChangedByPromotion, upsertScopedRule } from "../../canvas/styleTargets";
import { Dialog } from "../../dialogs/Dialog";
import { useCanvasStore } from "../../store/useCanvasStore";
import { useWorkspaceSnapshot } from "../../store/workspaceStore";
import { type StyleScopeChoice, StyleScopePicker, scopeOfChoice } from "./StyleScopePicker";
import { useStyleRules } from "./useStyleRules";
import {
  type StyledSurfaceKind,
  type StyleTarget,
  useSurfaceStyleDraft,
} from "./useSurfaceStyleDraft";

/** The plural a create-on-first-edit rule is named with. */
const KIND_WORDS: Record<StyledSurfaceKind, string> = {
  card: "card",
  section: "section",
  board: "board",
  edge: "link",
};

const SHAPE_LABELS: Record<StyleShape, string> = {
  rect: "Rectangle",
  pill: "Pill",
  diamond: "Diamond",
  parallelogram: "Parallelogram",
  circle: "Circle",
  document: "Document",
  database: "Database",
  hexagon: "Hexagon",
};

const SIDE_LABELS: Record<StyleSide, string> = {
  top: "Top",
  right: "Right",
  bottom: "Bottom",
  left: "Left",
};

const FLOW_LABELS: Record<StyleEdgeFlow, string> = {
  none: "Still",
  forward: "Along the link",
  reverse: "Reversed",
};

const PAINT_LABELS: Record<StyleEdgePaint, string> = {
  solid: "Solid",
  dashed: "Dashed",
  dotted: "Dotted",
  none: "None",
};

function roleLabel(role: StyleColourRole): string {
  return role
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export interface StyleTabProps {
  kind: StyledSurfaceKind;
  id: string;
  canEdit: boolean;
  /** The document to write through; defaults to the live one. */
  workspace?: WorkspaceDocument | null;
  /** The card's primary type, so the picker can offer "every Concept". */
  typeId?: string | null | undefined;
  /** The type's name, for the same option's label. */
  typeName?: string | null | undefined;
  /** Opens the rule list. Absent when the host has no dialog to offer. */
  onManageRules?: (() => void) | undefined;
  /**
   * Edit this rule rather than a surface. The rule list sets it: it has already said which scope the
   * reader chose, so the picker would be a second place to change it.
   */
  ruleId?: string | undefined;
}

/**
 * The Style tab: the one editor for the paint of any surface
 * (ADR-0051).
 *
 * Every control writes a *role* or a number, never a colour value, and writes
 * through the typed document layer — so a collaborator sees the same paint and a
 * theme change still moves it. A field left alone is absent from the record, so
 * "reset" and "never set" are the same state.
 */
export function StyleTab({
  kind,
  id,
  canEdit,
  workspace = null,
  typeId = null,
  typeName = null,
  onManageRules,
  ruleId,
}: StyleTabProps) {
  /**
   * Where this edit is going. The picker changes the *target*, not the controls: "this card" writes the
   * surface's own style and "every Concept" writes a rule, and everything between them is the same editor
   * (ADR-0071 amendment).
   */
  const [choice, setChoice] = useState<StyleScopeChoice>({ rung: "surface" });
  /**
   * The id a not-yet-created rule will be written under. Generated when the scope is chosen so the draft
   * has a target to edit; the rule itself only appears on the first change, so browsing costs nothing.
   */
  const [pendingRuleId, setPendingRuleId] = useState(() => `rule-${crypto.randomUUID()}`);
  const scope = scopeOfChoice(choice);

  const onScope = (next: StyleScopeChoice) => {
    setChoice(next);
    // A fresh id per scope: two rules must never be created under one identity because the reader
    // looked at two rungs before deciding.
    setPendingRuleId(`rule-${crypto.randomUUID()}`);
  };

  const rules = useStyleRules(workspace);
  const scopedRule = scope
    ? rules.find(
        (rule) => rule.scope.kind === scope.kind && (rule.scope.id ?? "") === (scope.id ?? ""),
      )
    : null;

  const target: StyleTarget = ruleId
    ? { rung: "rule", ruleId }
    : scope === null
      ? { rung: "surface", kind, id }
      : { rung: "rule", ruleId: scopedRule?.id ?? pendingRuleId };

  const createAs =
    scope && !ruleId
      ? {
          scope,
          name:
            scope.kind === "type"
              ? `Every ${typeName ?? "card of this type"}`
              : scope.kind === "global"
                ? "Everywhere"
                : scope.kind === "shell"
                  ? `Every ${scope.id}`
                  : `Every ${KIND_WORDS[kind]}`,
        }
      : null;

  const { style, resolved, inherited, patch, reset } = useSurfaceStyleDraft(
    target,
    workspace,
    createAs,
  );
  const current = style ?? {};

  /**
   * "Inherit" says where it inherits from once a rule names it — "Inherit from Concept"
   * rather than a word with no object (ADR-0071). When nothing wider has an opinion it
   * stays plain, because "Inherit from the default" is longer and says no more.
   */
  const inheritLabel = (utilityId: string): string => {
    const source = inherited(utilityId);
    return source && source.label !== "the default" ? `Inherit from ${source.label}` : "Inherit";
  };

  // A link is one stroke rather than a box with four sides (ADR-0051 §1), so its
  // editor shows the line and hides what a line cannot have: a silhouette, a
  // background, a text scale.
  const isLink = kind === "edge";
  const hasShape = !isLink;
  const hasText = !isLink;

  /**
   * Promoting a card's own style into a rule (ADR-0071
   * amendment).
   *
   * "Make every Concept look like this" is the gesture that makes the ladder discoverable, and it is a
   * document-wide write behind one press. The confirm counts the cards that will *actually* change: a card's
   * own style wins over any rule, so a card that already has one is not affected, and promising the type's
   * whole population would be a number the write does not deliver.
   */
  const snapshot = useWorkspaceSnapshot();
  const storeWorkspace = useCanvasStore((state) => state.workspace);
  const [promoteOpen, setPromoteOpen] = useState(false);
  const promotable =
    kind === "card" &&
    typeId !== null &&
    typeId !== undefined &&
    style !== undefined &&
    !isEmptyStyle(style);
  const promotionCount = promotable && typeId ? cardsChangedByPromotion(snapshot.cards, typeId) : 0;

  const promote = () => {
    if (!canEdit || !typeId || !style) return;
    const doc = workspace ?? storeWorkspace;
    doc.setStyleRules(
      upsertScopedRule(rules, {
        scope: { kind: "type", id: typeId },
        style,
        name: `Every ${typeName ?? "card of this type"}`,
        id: `rule-${crypto.randomUUID()}`,
      }),
    );
    // Nobody's own style is stripped: promotion states the rule and leaves every card as it is, so undo is
    // one step and a reader who liked their exception keeps it.
  };

  const update = (next: SurfaceStyle) => {
    if (!canEdit) return;
    patch(next);
  };

  /**
   * A link's stroke is stored on the same per-side record every surface uses, at
   * `top`: the stroke is its own only "edge". Every other surface writes the side
   * the reader picked.
   */
  const setLinePaint = (paint: StyleEdgePaint) => {
    const stroke = current.sides?.top;
    update({
      ...current,
      sides: { ...(current.sides ?? {}), top: { ...(stroke ?? { paint }), paint } },
    });
  };

  const setSide = (side: StyleSide, paint: StyleEdgePaint) => {
    const sides = { ...(current.sides ?? {}) };
    if (paint === "solid" && !sides[side]?.colour && !sides[side]?.width) delete sides[side];
    else sides[side] = { ...(sides[side] ?? {}), paint };
    update({ ...current, sides });
  };

  return (
    <div className="style-tab" data-testid="style-tab">
      {ruleId ? null : (
        <StyleScopePicker
          kind={kind}
          typeId={typeId}
          typeName={typeName}
          choice={choice}
          rules={rules}
          canEdit={canEdit}
          onChange={onScope}
          onManageRules={onManageRules}
        />
      )}

      {hasShape ? (
        <section className="style-tab__group">
          <h3 className="style-tab__heading">Shape</h3>
          <div className="style-tab__chips" data-testid="style-shapes">
            <button
              type="button"
              className="style-chip"
              data-checked={current.shape === undefined ? "true" : undefined}
              data-testid="style-shape-default"
              disabled={!canEdit}
              onClick={() => update({ ...current, shape: undefined })}
            >
              Default
            </button>
            {styleShapes.map((shape) => (
              <button
                key={shape}
                type="button"
                className="style-chip"
                data-checked={current.shape === shape ? "true" : undefined}
                data-testid={`style-shape-${shape}`}
                disabled={!canEdit}
                onClick={() => update({ ...current, shape })}
              >
                {SHAPE_LABELS[shape]}
              </button>
            ))}
          </div>
        </section>
      ) : null}

      <section className="style-tab__group">
        <h3 className="style-tab__heading">Paint</h3>
        {/* A stroke has no fill, so the background row would be a control that
            cannot do anything (ADR-0051 §1). */}
        {isLink ? null : (
          <label className="style-tab__row">
            <span>Background</span>
            <select
              data-testid="style-surface"
              value={current.surface ?? ""}
              disabled={!canEdit}
              onChange={(event) => {
                const value = event.target.value;
                update({
                  ...current,
                  surface: value === "" ? undefined : (value as StyleColourRole | "none"),
                });
              }}
            >
              <option value="">{inheritLabel("colour")}</option>
              <option value="none">Seamless</option>
              {styleColourRoles.map((role) => (
                <option key={role} value={role}>
                  {roleLabel(role)}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="style-tab__row">
          <span>{isLink ? "Stroke" : "Text"}</span>
          <select
            data-testid="style-ink"
            value={current.ink ?? ""}
            disabled={!canEdit}
            onChange={(event) => {
              const value = event.target.value;
              update({ ...current, ink: value === "" ? undefined : (value as StyleColourRole) });
            }}
          >
            <option value="">{inheritLabel("ink")}</option>
            {styleColourRoles.map((role) => (
              <option key={role} value={role}>
                {roleLabel(role)}
              </option>
            ))}
          </select>
        </label>
      </section>

      <section className="style-tab__group">
        <h3 className="style-tab__heading">{isLink ? "Line" : "Edges"}</h3>
        {isLink ? (
          <>
            <label className="style-tab__row">
              <span>Style</span>
              <select
                data-testid="style-line-paint"
                value={current.sides?.top?.paint ?? "solid"}
                disabled={!canEdit}
                onChange={(event) => setLinePaint(event.target.value as StyleEdgePaint)}
              >
                {styleEdgePaints.map((paint) => (
                  <option key={paint} value={paint}>
                    {PAINT_LABELS[paint]}
                  </option>
                ))}
              </select>
            </label>
            <label className="style-tab__row">
              <span>Width</span>
              <input
                type="range"
                data-testid="style-line-width"
                min={1}
                max={8}
                step={0.5}
                value={current.sides?.top?.width ?? 1.6}
                disabled={!canEdit}
                onChange={(event) => {
                  const width = Number(event.target.value);
                  const stroke = current.sides?.top;
                  update({
                    ...current,
                    sides: {
                      ...(current.sides ?? {}),
                      top: { paint: stroke?.paint ?? "solid", ...stroke, width },
                    },
                  });
                }}
              />
              <span className="style-tab__value">
                {(current.sides?.top?.width ?? 1.6).toFixed(1)}
              </span>
            </label>
            <label className="style-tab__row">
              <span>Flow</span>
              <select
                data-testid="style-line-flow"
                value={current.sides?.top?.flow ?? ""}
                disabled={!canEdit}
                onChange={(event) => {
                  const value = event.target.value;
                  const stroke = current.sides?.top;
                  const flow = value === "" ? undefined : (value as StyleEdgeFlow);
                  update({
                    ...current,
                    sides: {
                      ...(current.sides ?? {}),
                      top: { paint: stroke?.paint ?? "solid", ...stroke, flow },
                    },
                  });
                }}
              >
                <option value="">Along the link</option>
                {styleEdgeFlows
                  .filter((flow) => flow !== "forward")
                  .map((flow) => (
                    <option key={flow} value={flow}>
                      {FLOW_LABELS[flow]}
                    </option>
                  ))}
              </select>
            </label>
            <p className="style-tab__hint">
              A link has one stroke, so there is one line style rather than four. A dashed line
              travels from its source to its target unless it is reversed.
            </p>
          </>
        ) : (
          <>
            {styleSides.map((side) => (
              <label key={side} className="style-tab__row">
                <span>{SIDE_LABELS[side]}</span>
                <select
                  data-testid={`style-side-${side}`}
                  value={current.sides?.[side]?.paint ?? "solid"}
                  disabled={!canEdit}
                  onChange={(event) => setSide(side, event.target.value as StyleEdgePaint)}
                >
                  {styleEdgePaints.map((paint) => (
                    <option key={paint} value={paint}>
                      {PAINT_LABELS[paint]}
                    </option>
                  ))}
                </select>
              </label>
            ))}
            <p className="style-tab__hint">
              A dashed edge runs with the shape: clockwise from the top. Its direction is the
              shape's, so two sides never disagree by accident.
            </p>
          </>
        )}
      </section>

      <section className="style-tab__group">
        <h3 className="style-tab__heading">{hasText ? "Scale" : "Opacity"}</h3>
        {hasText ? (
          <label className="style-tab__row">
            <span>Text size</span>
            <input
              type="range"
              data-testid="style-text-scale"
              min={TEXT_SCALE_MIN}
              max={TEXT_SCALE_MAX}
              step={0.05}
              value={current.textScale ?? 1}
              disabled={!canEdit}
              onChange={(event) => update({ ...current, textScale: Number(event.target.value) })}
            />
            <span className="style-tab__value">{Math.round(resolved.textScale * 100)}%</span>
          </label>
        ) : null}
        <label className="style-tab__row">
          <span>Opacity</span>
          <input
            type="range"
            data-testid="style-opacity"
            // The floor is a constant, not a choice: a surface its owner cannot see
            // is one a collaborator cannot see either (ADR-0051 §5).
            min={resolved.opacity < 0.25 ? resolved.opacity : 0.25}
            max={1}
            step={0.05}
            value={current.opacity ?? 1}
            disabled={!canEdit}
            onChange={(event) => update({ ...current, opacity: Number(event.target.value) })}
          />
          <span className="style-tab__value">{Math.round(resolved.opacity * 100)}%</span>
        </label>
      </section>

      {promotable ? (
        <button
          type="button"
          className="style-tab__promote"
          data-testid="style-promote"
          disabled={!canEdit}
          onClick={() => setPromoteOpen(true)}
        >
          Apply to every {typeName ?? "card of this type"}…
        </button>
      ) : null}

      <button
        type="button"
        className="style-tab__reset"
        data-testid="style-reset"
        disabled={!canEdit || style === undefined}
        onClick={reset}
      >
        Reset style
      </button>

      {promoteOpen ? (
        <Dialog
          title={`Apply to every ${typeName ?? "card of this type"}?`}
          description={
            promotionCount === 0
              ? "Every card of this type already has a style of its own, so this rule would change none of them. It still records the intent for new cards."
              : `This sets a rule for ${promotionCount} ${
                  promotionCount === 1 ? "card" : "cards"
                } of this type. Cards with a style of their own keep it — a card beats a rule.`
          }
          onClose={() => setPromoteOpen(false)}
          actions={[{ label: "Apply", primary: true, onSelect: promote }]}
        />
      ) : null}
    </div>
  );
}
