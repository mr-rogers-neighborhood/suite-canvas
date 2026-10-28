import type { StyleEdgePaint, StyleSide, SurfaceStyle, WorkspaceDocument } from "@suite/graph";
import { styleShapes, styleSides, TEXT_SCALE_MAX, TEXT_SCALE_MIN } from "@suite/graph";
import { useSurfacePaint } from "../../canvas/surfaceContext";
import { isShapedSurface } from "../../canvas/surfacePaint";
import { FLOW_OPTIONS, PAINT_OPTIONS, SHAPE_LABELS, SIDE_LABELS } from "../styleOptions";
import { type StyleSurfaceKind, useStyleDraft } from "./useStyleDraft";

/**
 * An enumerated choice as chips, which is the only shape this editor uses for one.
 *
 * A select hides its options behind a press and renders as a different control
 * from the shape and fill rows beside it; chips make the whole panel read as one
 * vocabulary.
 */
function ChipRow<T extends string>({
  label,
  testId,
  value,
  options,
  disabled,
  onSelect,
}: {
  label: string;
  testId: string;
  value: T | undefined;
  options: readonly { value: T | undefined; label: string }[];
  disabled: boolean;
  onSelect: (value: T | undefined) => void;
}) {
  return (
    <div className="style-tab__row" data-testid={testId}>
      <span>{label}</span>
      <div className="style-tab__chips">
        {options.map((option) => (
          <button
            key={option.label}
            type="button"
            className="style-chip"
            data-testid={`${testId}-${option.value ?? "default"}`}
            data-checked={value === option.value ? "true" : undefined}
            disabled={disabled}
            onClick={() => onSelect(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export interface StyleTabProps {
  kind: StyleSurfaceKind;
  id: string;
  canEdit: boolean;
  /** The document to write through; defaults to the live one. */
  workspace?: WorkspaceDocument | null;
  /** The type's name, so the promote control can say what it writes to. */
  typeName?: string | null | undefined;
}

/**
 * The Style tab: the one editor for the paint of a card, a link or a type.
 *
 * Every control writes a palette swatch, a role or a number, never a raw colour
 * value, and writes through the typed document layer — so a collaborator sees the
 * same paint and a theme change still moves it. A field left alone is absent from
 * the record, so "reset" and "never set" are the same state.
 *
 * The same component is mounted by the inspector, by the type editor and by the
 * board's right-click Appearance submenu. There is one editor, so the three cannot
 * drift.
 */
export function StyleTab({ kind, id, canEdit, workspace = null, typeName = null }: StyleTabProps) {
  const { style, resolved, typeId, typeStyle, patch, reset, makeTypeDefault } = useStyleDraft(
    { kind, id },
    workspace,
  );
  const { palette, mode } = useSurfacePaint();
  const current = style ?? {};

  // A link is one stroke rather than a box with four sides (ADR-0051 §1), so its
  // editor shows the line and hides what a line cannot have: a silhouette, a
  // background, a text scale.
  const isLink = kind === "edge";
  const hasShape = !isLink;
  const hasText = !isLink;

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

  /**
   * A silhouette has one outline, not four sides.
   *
   * A diamond has no top edge to style separately from its bottom one, so offering four
   * rows would be offering three choices that cannot be seen. The row writes the same
   * paint to all four sides and reads it back from `top`, which is the side a *shape*
   * already draws with — and the side a link's stroke lives on, so "the outline" is one
   * field whichever surface is being edited.
   */
  const setOutline = (paint: StyleEdgePaint) => {
    const source = current.sides?.top;
    const sides: NonNullable<SurfaceStyle["sides"]> = {};
    for (const side of styleSides) sides[side] = { ...(source ?? {}), paint };
    update({ ...current, sides });
  };

  // The shape the surface actually wears, which may come from its type rather than from
  // anything set here.
  const shaped = isShapedSurface(resolved.shape);

  const inherits =
    kind === "card" &&
    typeStyle !== undefined &&
    Object.keys(typeStyle).length > 0 &&
    style === undefined;

  return (
    <div className="style-tab" data-testid="style-tab">
      {inherits ? (
        <p className="style-tab__hint" data-testid="style-inherits">
          This card wears {typeName ?? "its type"}'s style. Anything set here wins over it.
        </p>
      ) : null}

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
          <div className="style-tab__row" data-testid="style-swatches">
            <span>Fill</span>
            <div className="style-tab__swatches">
              <button
                type="button"
                className="style-swatch"
                data-testid="style-swatch-default"
                data-checked={
                  current.swatch === undefined && current.surface === undefined ? "true" : undefined
                }
                disabled={!canEdit}
                title="Theme default"
                onClick={() => update({ ...current, swatch: undefined, surface: undefined })}
              >
                Default
              </button>
              <button
                type="button"
                className="style-swatch"
                data-testid="style-swatch-none"
                data-checked={current.surface === "none" ? "true" : undefined}
                disabled={!canEdit}
                title="No fill"
                onClick={() => update({ ...current, swatch: undefined, surface: "none" })}
              >
                None
              </button>
              {palette.map((swatch) => (
                <button
                  key={swatch.id}
                  type="button"
                  className="style-swatch"
                  data-testid={`style-swatch-${swatch.id}`}
                  data-checked={current.swatch === swatch.id ? "true" : undefined}
                  disabled={!canEdit}
                  title={swatch.name}
                  aria-label={swatch.name}
                  onClick={() => update({ ...current, swatch: swatch.id })}
                >
                  <span
                    aria-hidden="true"
                    className="style-swatch__dot"
                    style={{ backgroundColor: swatch[mode] }}
                  />
                  {swatch.name}
                </button>
              ))}
            </div>
          </div>
        )}
        {/* The ink row is gone: it repainted a role the theme already resolves,
            so choosing "Canvas" or "Hairline" on a card changed nothing a reader
            could see. A colour someone can name is the palette, not a token. */}
      </section>

      <section className="style-tab__group">
        <h3 className="style-tab__heading">{isLink ? "Line" : "Edges"}</h3>
        {isLink ? (
          <>
            <ChipRow
              label="Style"
              testId="style-line-paint"
              value={current.sides?.top?.paint ?? "solid"}
              disabled={!canEdit}
              options={PAINT_OPTIONS}
              onSelect={(paint) => setLinePaint(paint ?? "solid")}
            />
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
            <ChipRow
              label="Flow"
              testId="style-line-flow"
              value={current.sides?.top?.flow ?? undefined}
              disabled={!canEdit}
              options={FLOW_OPTIONS}
              onSelect={(flow) => {
                const stroke = current.sides?.top;
                update({
                  ...current,
                  sides: {
                    ...(current.sides ?? {}),
                    top: { paint: stroke?.paint ?? "solid", ...stroke, flow },
                  },
                });
              }}
            />
          </>
        ) : shaped ? (
          <ChipRow
            label="Outline"
            testId="style-outline"
            value={current.sides?.top?.paint ?? "solid"}
            disabled={!canEdit}
            options={PAINT_OPTIONS}
            onSelect={(paint) => setOutline(paint ?? "solid")}
          />
        ) : (
          styleSides.map((side) => (
            <ChipRow
              key={side}
              label={SIDE_LABELS[side]}
              testId={`style-side-${side}`}
              value={current.sides?.[side]?.paint ?? "solid"}
              disabled={!canEdit}
              options={PAINT_OPTIONS}
              onSelect={(paint) => setSide(side, paint ?? "solid")}
            />
          ))
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

      {kind === "card" && typeId !== null ? (
        <button
          type="button"
          className="style-tab__promote"
          data-testid="style-make-default"
          disabled={!canEdit || style === undefined}
          title={
            typeStyle === undefined
              ? "New cards of this type will start with this style."
              : "New cards of this type will start with this style. Cards with their own style keep it."
          }
          onClick={makeTypeDefault}
        >
          {typeStyle === undefined
            ? `Make this the default for ${typeName ?? "this type"} cards`
            : `Replace the default for ${typeName ?? "this type"} cards`}
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
    </div>
  );
}
