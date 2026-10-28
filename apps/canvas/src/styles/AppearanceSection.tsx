import { useId } from "react";
import { useCanvasStore } from "../store/useCanvasStore";
import { type Appearance, RADIUS_RANGE } from "../theme/appearance";
import { useAppearanceStore } from "../theme/useAppearanceStore";
import { PaletteEditor } from "./PaletteEditor";

/**
 * The appearance controls (ADR-0071): the palette, density, corner rounding, the
 * canvas treatment and motion.
 *
 * Two scopes, clearly apart. The palette belongs to the document: a swatch a
 * reader defines here is a colour their collaborators can pick. Everything below
 * it is this device only, because how bright somebody's screen is has nothing to
 * do with how the work looks to anyone else. Every change is applied immediately,
 * so the preview is the canvas behind the panel rather than a mock inside it.
 */
/** An enumerated choice as chips; the panel uses one shape for every choice. */
function ChipRow({
  label,
  testId,
  value,
  options,
  onSelect,
}: {
  label: string;
  testId: string;
  value: string;
  options: readonly { value: string; label: string }[];
  onSelect: (value: string) => void;
}) {
  return (
    <div className="appearance-dialog__row" data-testid={testId}>
      <span>{label}</span>
      <div className="style-tab__chips">
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            className="style-chip"
            data-testid={`${testId}-${option.value}`}
            data-checked={value === option.value ? "true" : undefined}
            onClick={() => onSelect(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function AppearanceSection() {
  const appearance = useAppearanceStore((state) => state.appearance);
  const workspace = useCanvasStore((state) => state.workspace);
  const set = useAppearanceStore((state) => state.set);
  const reset = useAppearanceStore((state) => state.reset);
  const noteId = useId();

  const change = (patch: Partial<Appearance>) => set(patch);

  return (
    <section aria-labelledby={noteId} data-testid="appearance-dialog">
      <h3 id={noteId} className="text-[12px] font-semibold">
        Appearance
      </h3>
      <p className="mt-0.5 text-[11px] leading-4 text-[var(--ink-muted)]">
        These change this device only. The workspace's own colours and shapes stay as its authors
        set them.
      </p>

      <PaletteEditor workspace={workspace} />

      {/* Density is one setting that means nothing until spacing actually moves;
          it is out until then rather than a switch that changes no pixel. */}

      <label className="appearance-dialog__row">
        <span>Corners</span>
        <span className="appearance-dialog__slider">
          <input
            type="range"
            data-testid="appearance-radius"
            min={RADIUS_RANGE.min}
            max={RADIUS_RANGE.max}
            step={RADIUS_RANGE.step}
            value={appearance.radius}
            onChange={(event) => change({ radius: Number(event.target.value) })}
          />
          <span className="appearance-dialog__value" data-testid="appearance-radius-value">
            {`${appearance.radius}px`}
          </span>
        </span>
      </label>

      <ChipRow
        label="Canvas"
        testId="appearance-canvas"
        value={appearance.canvasBackground}
        options={[
          { value: "dots", label: "Dot grid" },
          { value: "plain", label: "Plain" },
        ]}
        onSelect={(canvasBackground) =>
          change({ canvasBackground: canvasBackground as Appearance["canvasBackground"] })
        }
      />

      <ChipRow
        label="Motion"
        testId="appearance-motion"
        value={appearance.motion}
        options={[
          { value: "full", label: "Full" },
          { value: "reduced", label: "Reduced" },
        ]}
        onSelect={(motion) => change({ motion: motion as Appearance["motion"] })}
      />

      <button
        type="button"
        className="appearance-dialog__reset"
        data-testid="appearance-reset"
        onClick={reset}
      >
        Reset to defaults
      </button>
    </section>
  );
}
