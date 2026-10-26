import { useId } from "react";
import { useCanvasStore } from "../store/useCanvasStore";
import { type Appearance, RADIUS_RANGE } from "../theme/appearance";
import { useAppearanceStore } from "../theme/useAppearanceStore";
import { useThemeStore } from "../theme/useThemeStore";
import { useWorkspaceTheme } from "../theme/useWorkspaceTheme";
import { themedRoles } from "../theme/workspaceTheme";

/**
 * The appearance entry point (ADR-0071),
 * reached from the theme switcher — the button that already asks "how should this look".
 *
 * It offers the four things a reader owns alone: density, corner rounding, the canvas
 * treatment and motion. Nothing here can restyle a card for anybody else, which is the
 * line the ADR draws: what a reader controls is how *their* screen draws; what the
 * document controls is how the work looks to everyone.
 *
 * Every change is applied immediately (the store paints `<html>`), so the preview is the
 * canvas behind this panel rather than a mock inside it.
 */
export function AppearanceDialog({ onClose }: { onClose: () => void }) {
  const appearance = useAppearanceStore((state) => state.appearance);
  const workspace = useCanvasStore((state) => state.workspace);
  const mode = useThemeStore((state) => state.theme);
  const themed = themedRoles(useWorkspaceTheme(workspace), mode);
  const set = useAppearanceStore((state) => state.set);
  const reset = useAppearanceStore((state) => state.reset);
  const titleId = useId();

  const change = (patch: Partial<Appearance>) => set(patch);

  return (
    <div
      className="appearance-dialog"
      data-testid="appearance-dialog"
      role="dialog"
      aria-labelledby={titleId}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <header className="appearance-dialog__header">
        <h2 id={titleId} className="appearance-dialog__title">
          Appearance
        </h2>
        <button
          type="button"
          className="appearance-dialog__close"
          data-testid="appearance-close"
          aria-label="Close appearance"
          onClick={onClose}
        >
          {"\u00d7"}
        </button>
      </header>

      <p className="appearance-dialog__note">
        These change this device only. The workspace's own colours and shapes stay as its authors
        set them.
      </p>

      {/*
        The mirror, not a second editor: a palette belongs to the document and is
        written in the Styles list, so this names the scope and the roles it speaks
        for and says no more. Two editors for one value is how the save pill
        happened.
      */}
      <p className="appearance-dialog__row" data-testid="appearance-workspace-theme">
        <span>Workspace colours</span>
        <span className="appearance-dialog__value">
          {themed.length === 0
            ? "Built-in palette"
            : `${themed.length} role(s) set here, ${mode === "dark" ? "dark" : "light"} mode`}
        </span>
      </p>

      <label className="appearance-dialog__row">
        <span>Density</span>
        <select
          data-testid="appearance-density"
          value={appearance.density}
          onChange={(event) => change({ density: event.target.value as Appearance["density"] })}
        >
          <option value="comfortable">Comfortable</option>
          <option value="compact">Compact</option>
        </select>
      </label>

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

      <label className="appearance-dialog__row">
        <span>Canvas</span>
        <select
          data-testid="appearance-canvas"
          value={appearance.canvasBackground}
          onChange={(event) =>
            change({ canvasBackground: event.target.value as Appearance["canvasBackground"] })
          }
        >
          <option value="dots">Dot grid</option>
          <option value="plain">Plain</option>
        </select>
      </label>

      <label className="appearance-dialog__row">
        <span>Motion</span>
        <select
          data-testid="appearance-motion"
          value={appearance.motion}
          onChange={(event) => change({ motion: event.target.value as Appearance["motion"] })}
        >
          <option value="full">Full</option>
          <option value="reduced">Reduced</option>
        </select>
      </label>

      <button
        type="button"
        className="appearance-dialog__reset"
        data-testid="appearance-reset"
        onClick={reset}
      >
        Reset to defaults
      </button>
    </div>
  );
}
