import type { AnnotationStyle } from "@suite/graph";
import { useState } from "react";
import { ContextMenu } from "../dialogs/ContextMenu";
import { IconGlyph } from "../icons/IconGlyph";

/**
 * One colour, held, so a run of passages marks as the reader goes.
 *
 * The palette is the right gesture for one passage: four colours, chosen in the moment. It is the wrong gesture for a
 * page of them — every mark is a press, a choice and a dismissal — so a reader can pin a colour and then drag over
 * passage after passage with nothing in between. Pressing the button again puts the palette back, which is also the way
 * out: a mode with no visible way out is a mode a reader is stuck in.
 */
export interface ArmedColourProps {
  readonly styles: readonly AnnotationStyle[];
  /** The colour that will be used for the next passage, or null when every passage picks its own. */
  readonly armed: string | null;
  readonly onArm: (styleId: string | null) => void;
}

export function ArmedColour({ styles, armed, onArm }: ArmedColourProps) {
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);
  const current = styles.find((style) => style.id === armed) ?? null;
  return (
    <>
      <button
        type="button"
        className="views-icon-button"
        aria-label={current === null ? "Hold a colour" : `Holding ${current.name}`}
        title={
          current === null
            ? "Hold a colour for every passage you mark"
            : `Holding ${current.name}. Press to stop holding it.`
        }
        aria-pressed={current !== null}
        data-testid="reader-armed-toggle"
        style={
          current === null
            ? undefined
            : // The colour itself, because the whole point of the button is which one is held.
              { color: current.color, boxShadow: `inset 0 0 0 2px ${current.color}` }
        }
        onClick={(event) => {
          if (current !== null) {
            onArm(null);
            return;
          }
          const box = event.currentTarget.getBoundingClientRect();
          setAt({ x: box.left, y: box.bottom + 4 });
        }}
      >
        <IconGlyph icon={current === null ? "lucide:pin" : "lucide:pin-off"} size={14} />
      </button>
      {at === null ? null : (
        <ContextMenu
          x={at.x}
          y={at.y}
          onClose={() => setAt(null)}
          items={styles.map((style) => ({
            label: style.name,
            swatch: { light: style.color, dark: style.color },
            swatchSelected: style.id === armed,
            onSelect: () => {
              onArm(style.id);
              setAt(null);
            },
          }))}
        />
      )}
    </>
  );
}
