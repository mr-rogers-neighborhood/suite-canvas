/**
 * The desk's heads-up display.
 *
 * Everything a reader can learn about the surface itself: which phase it is in,
 * what the adapter is, what the seed did, the frame rate, and the two actions
 * that do not touch the document (Reset, and Copy diagnostics). Presentational
 * on purpose — the state and the actions live in `useIceDeskBoot`, so the HUD
 * can be shown in Storybook without a GPU.
 */

import { type DemoMode, demoLabel, type SeedReport } from "./iceSurfaceSpawns";
import {
  adapterLine,
  type EngineState,
  engineLine,
  type Phase,
  skipTally,
} from "./iceSurfaceStatus";

export interface IceSurfaceHudProps {
  readonly phase: Phase;
  readonly engineState: EngineState | null;
  readonly seed: SeedReport | null;
  readonly fps: number | null;
  readonly mode: DemoMode;
  readonly workspaceMode: boolean;
  readonly copyState: string | null;
  readonly portalPath: readonly string[];
  readonly onChooseDemo: (mode: DemoMode) => void;
  readonly onReset: () => void;
  readonly onCopyDiagnostics: () => void;
}

export function IceSurfaceHud({
  phase,
  engineState,
  seed,
  fps,
  mode,
  workspaceMode,
  copyState,
  portalPath,
  onChooseDemo,
  onReset,
  onCopyDiagnostics,
}: IceSurfaceHudProps) {
  return (
    <div className="ice-surface__badge" data-testid="ice-hud">
      <span className="ice-surface__badge-title">
        {workspaceMode ? "ICE workspace" : "ICE demo"}
      </span>
      <span className="ice-surface__badge-note">
        {workspaceMode
          ? "Live workspace · writes go through Loro"
          : "Experimental — not document truth"}
      </span>
      <span className="ice-surface__badge-status" data-testid="ice-status" aria-live="polite">
        {engineLine(phase, engineState)}
      </span>
      <span className="ice-surface__badge-meta" data-testid="ice-phase">
        phase: {phase.kind}
      </span>
      {workspaceMode ? null : (
        <fieldset className="ice-surface__modes" data-testid="ice-demo-modes">
          <legend>Demo seed</legend>
          <button
            type="button"
            className="ice-surface__button"
            data-testid="ice-demo-native"
            aria-pressed={mode === "native"}
            onClick={() => onChooseDemo("native")}
          >
            Native demo
          </button>
          <button
            type="button"
            className="ice-surface__button"
            data-testid="ice-demo-suite"
            aria-pressed={mode === "suite"}
            onClick={() => onChooseDemo("suite")}
          >
            Suite demo
          </button>
        </fieldset>
      )}
      <span className="ice-surface__badge-seed" data-testid="ice-demo-summary" aria-live="polite">
        {seed === null
          ? workspaceMode
            ? "Workspace: not seeded"
            : `${demoLabel(mode)}: not seeded`
          : seed.mode === "workspace"
            ? `Workspace: ${seed.seeded} objects / ${seed.boards} boards`
            : seed.mode === "suite"
              ? `Suite demo: ${seed.seeded} objects / ${seed.boards} boards`
              : `Native demo: ${seed.seeded} objects`}
      </span>
      <span className="ice-surface__badge-seed" data-testid="ice-seed">
        {seed === null ? "seeded: —" : `${seed.seeded}/${seed.total} objects seeded`}
      </span>
      {seed !== null && seed.skipped.length > 0 ? (
        <span
          className="ice-surface__badge-meta"
          data-testid="ice-demo-skipped"
          title={seed.skipped.map((skip) => `${skip.reason}: ${skip.detail}`).join("\n")}
        >
          skipped: {skipTally(seed.skipped)}
        </span>
      ) : null}
      <span
        className="ice-surface__badge-meta"
        data-testid="ice-adapter"
        title={adapterLine(phase)}
      >
        {adapterLine(phase)}
      </span>
      <span className="ice-surface__badge-meta" data-testid="ice-fps">
        fps: {fps === null ? "—" : fps}
      </span>
      {seed !== null && seed.failures.length > 0 ? (
        <span
          className="ice-surface__badge-failure"
          data-testid="ice-seed-failures"
          title={seed.failures.join("\n")}
        >
          {seed.failures.join("; ")}
        </span>
      ) : null}
      <div className="ice-surface__actions">
        <button
          type="button"
          className="ice-surface__button"
          data-testid="ice-reset"
          onClick={onReset}
        >
          {workspaceMode ? "Reload workspace" : "Reset demo"}
        </button>
        <button
          type="button"
          className="ice-surface__button"
          data-testid="ice-copy-diagnostics"
          onClick={onCopyDiagnostics}
        >
          Copy diagnostics
        </button>
      </div>
      {copyState === null ? null : (
        <span className="ice-surface__copy-status" data-testid="ice-copy-status" aria-live="polite">
          {copyState}
        </span>
      )}
      {portalPath.length > 0 ? (
        <span className="ice-surface__badge-meta" data-testid="ice-portal-path">
          Inside {portalPath.join(" › ")} · Escape to return
        </span>
      ) : null}
      <span className="ice-surface__badge-hint">
        {workspaceMode
          ? "Select and drag a card · drag a handle to resize · double-click a mat to enter, a whiteboard to draw · Escape returns"
          : "Pan the mat · wheel to zoom · drag a note to move it"}
      </span>
    </div>
  );
}
