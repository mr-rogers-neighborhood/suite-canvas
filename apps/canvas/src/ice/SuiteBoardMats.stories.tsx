import type { Meta, StoryObj } from "@storybook/react-vite";
import type { CSSProperties } from "react";

import {
  BOARD_MAT_MIN_DELTA_E,
  BOARD_MAT_MIN_VALUE_STEP,
  boardMatContrast,
  boardMatGround,
  boardMatVerdict,
  SUITE_BOARD_MATS,
} from "./suiteBoardMats";
import type { SuiteDeskTheme } from "./suiteDeskTheme";

/**
 * The six Board mats, side by side in both themes (ADR-0043 §5).
 *
 * The mats themselves are GPU vinyls — the mini mat program resolves
 * `props.vinyl` by name and lights it with the desk's own light — so this is not
 * a photograph of the desk. It is the *albedo* each material is handed, drawn
 * over the ground of each theme, with the two numbers the ADR asks for beside
 * it: how far apart the nearest pair is (OKLab ΔE, where ~2.3 is just
 * noticeable and ~10 is unmistakable) and how far apart the nearest two are in
 * value (relative luminance).
 *
 * The numbers are computed from the inks the app ships (`suiteBoardMats.ts`),
 * not typed in, so a palette edit that collapses two mats fails here and in the
 * unit test rather than being admired.
 */
interface MatSwatchProps {
  readonly theme: SuiteDeskTheme;
}

const PANEL: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(6, minmax(0, 1fr))",
  gap: 12,
};

function MatSwatch({ theme }: MatSwatchProps) {
  const ground = boardMatGround(theme);
  const verdict = boardMatVerdict(theme);
  return (
    <section
      data-testid={`board-mats-${theme}`}
      data-distinct={verdict.distinct ? "true" : "false"}
      style={{
        background: ground,
        // Text on a mat is read, so it is held to a real contrast ratio: the
        // inks are muted on purpose and the labels must not be (axe checks it).
        color: theme === "dark" ? "#f2f2f4" : "#232326",
        padding: 24,
        borderRadius: 12,
      }}
    >
      <header style={{ marginBottom: 16, fontFamily: "system-ui, sans-serif" }}>
        <strong style={{ fontSize: 15 }}>{theme === "dark" ? "Night desk" : "Day desk"}</strong>
        <div style={{ fontSize: 12, marginTop: 4 }}>
          nearest pair {verdict.closest.left.color}/{verdict.closest.right.color} · ΔE{" "}
          {verdict.closest.distance.toFixed(1)} (floor {BOARD_MAT_MIN_DELTA_E}) · value step{" "}
          {verdict.closestValue.valueStep.toFixed(3)} (floor {BOARD_MAT_MIN_VALUE_STEP.toFixed(2)})
          · {verdict.distinct ? "six materials" : "COLLAPSED"}
        </div>
      </header>
      <div style={PANEL}>
        {SUITE_BOARD_MATS.map((mat) => (
          <figure key={mat.color} style={{ margin: 0 }}>
            <div
              data-testid={`board-mat-${theme}-${mat.color}`}
              style={{
                background: mat.ink,
                // The mat is a large, soft-edged object; 120 px keeps the swatch
                // the same weight on screen as a Board at reading zoom.
                height: 120,
                borderRadius: 8,
                boxShadow: "0 1px 2px rgba(0, 0, 0, 0.18)",
              }}
            />
            <figcaption
              style={{
                fontFamily: "system-ui, sans-serif",
                fontSize: 12,
                marginTop: 8,
                display: "flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              <span
                aria-hidden="true"
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: 999,
                  background: `var(--section-${mat.color}, ${mat.ink})`,
                  display: "inline-block",
                }}
              />
              {mat.color}
              <span>
                {mat.vinyl} · {boardMatContrast(mat.ink, ground).toFixed(1)}:1
              </span>
            </figcaption>
          </figure>
        ))}
      </div>
    </section>
  );
}

function MatsStage() {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 24,
        padding: 24,
        minHeight: "100vh",
        background: "var(--canvas-bg, #f5f5f7)",
        boxSizing: "border-box",
      }}
    >
      <MatSwatch theme="light" />
      <MatSwatch theme="dark" />
    </div>
  );
}

const meta = {
  title: "Canvas/ICE board mats",
  component: MatsStage,
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "ADR-0043 §5: `boardColors` has six values, so the mat has six vinyls — `board-slate`, " +
          "`board-blue`, `board-green`, `board-amber`, `board-rose`, `board-violet` — each a " +
          "desaturated tint of its accent, and each separated from its neighbours in value as well " +
          "as hue. The two panels are the same six albedos over each theme's desk ground: a mat has " +
          "to read off its own ground, and two mats have to read as two objects.",
      },
    },
  },
} satisfies Meta<typeof MatsStage>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Both themes at once: the same six mats over the day ground and the night ground. */
export const BothThemes: Story = {};
