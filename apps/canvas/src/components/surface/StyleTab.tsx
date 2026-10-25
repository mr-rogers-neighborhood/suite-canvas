import type {
  StyleColourRole,
  StyleEdgePaint,
  StyleShape,
  StyleSide,
  SurfaceStyle,
} from "@suite/graph";
import {
  styleColourRoles,
  styleEdgePaints,
  styleShapes,
  styleSides,
  TEXT_SCALE_MAX,
  TEXT_SCALE_MIN,
} from "@suite/graph";
import {
  type StyledSurface,
  type StyledSurfaceKind,
  useSurfaceStyleDraft,
} from "./useSurfaceStyleDraft";

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
}

/**
 * The Style tab: the one editor for the paint of any surface
 * ([ADR-0051](../../docs/decisions/0051-one-style-vocabulary-over-edges.md)).
 *
 * Every control writes a *role* or a number, never a colour value, and writes
 * through the typed document layer — so a collaborator sees the same paint and a
 * theme change still moves it. A field left alone is absent from the record, so
 * "reset" and "never set" are the same state.
 */
export function StyleTab({ kind, id, canEdit }: StyleTabProps) {
  const target: StyledSurface = { kind, id };
  const { style, resolved, patch, reset } = useSurfaceStyleDraft(target);
  const current = style ?? {};

  const update = (next: SurfaceStyle) => {
    if (!canEdit) return;
    patch(next);
  };

  const setSide = (side: StyleSide, paint: StyleEdgePaint) => {
    const sides = { ...(current.sides ?? {}) };
    if (paint === "solid" && !sides[side]?.colour && !sides[side]?.width) delete sides[side];
    else sides[side] = { ...(sides[side] ?? {}), paint };
    update({ ...current, sides });
  };

  return (
    <div className="style-tab" data-testid="style-tab">
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

      <section className="style-tab__group">
        <h3 className="style-tab__heading">Paint</h3>
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
            <option value="">Inherit</option>
            <option value="none">Seamless</option>
            {styleColourRoles.map((role) => (
              <option key={role} value={role}>
                {roleLabel(role)}
              </option>
            ))}
          </select>
        </label>
        <label className="style-tab__row">
          <span>Text</span>
          <select
            data-testid="style-ink"
            value={current.ink ?? ""}
            disabled={!canEdit}
            onChange={(event) => {
              const value = event.target.value;
              update({ ...current, ink: value === "" ? undefined : (value as StyleColourRole) });
            }}
          >
            <option value="">Inherit</option>
            {styleColourRoles.map((role) => (
              <option key={role} value={role}>
                {roleLabel(role)}
              </option>
            ))}
          </select>
        </label>
      </section>

      <section className="style-tab__group">
        <h3 className="style-tab__heading">Edges</h3>
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
          A dashed edge runs with the shape: clockwise from the top. Its direction is the shape's,
          so two sides never disagree by accident.
        </p>
      </section>

      <section className="style-tab__group">
        <h3 className="style-tab__heading">Scale</h3>
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

      <button
        type="button"
        className="style-tab__reset"
        data-testid="style-reset"
        disabled={!canEdit || style === undefined}
        onClick={reset}
      >
        Reset style
      </button>
    </div>
  );
}
