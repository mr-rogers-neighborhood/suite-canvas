import {
  parseStep,
  STEP_ATTRIBUTES,
  type Target,
  TOUR_STEP_NODE_NAME,
  type TourStepAttributes,
  type TourStepViewport,
  targetSchema,
  tourStepAdvanceModes,
} from "@suite/graph";
import { mergeAttributes, Node, ReactNodeViewRenderer } from "@tiptap/react";
import { TourStepView } from "./TourStepView";

export interface TourStepOptions {
  HTMLAttributes: Record<string, unknown>;
  /** Card that owns this body: the tutorial a step belongs to. */
  cardId: string;
}

/** Targets survive a copy as JSON in one attribute; a malformed one is ignored. */
function parseTargetsAttribute(value: string | null): Target[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((entry) => {
      const target = targetSchema.safeParse(entry);
      return target.success ? [target.data] : [];
    });
  } catch {
    return [];
  }
}

function parseViewportAttribute(value: string | null): TourStepViewport | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (typeof parsed !== "object" || parsed === null) return null;
    const { x, y, zoom } = parsed as Record<string, unknown>;
    if (typeof x !== "number" || typeof y !== "number" || typeof zoom !== "number") return null;
    return { x, y, zoom };
  } catch {
    return null;
  }
}

/** The step the block currently holds, in the stored shape (or null). */
export function stepOfAttributes(attributes: unknown) {
  return parseStep(attributes);
}

/**
 * One stop of a tour, as a block in the tutorial card's body
 * ([ADR-0054](../../../../docs/decisions/0054-a-tutorial-is-a-card.md)).
 *
 * The block is an atom: a step is a value, not a container, so the caption is
 * authored prose the block owns and the target is a reference rather than a
 * copy. Its attributes are the stored step, and every surface reads them
 * through `parseStep` — which is why the block round-trips through
 * `@suite/graph` and not through its own serialisation.
 */
export const TourStep = Node.create<TourStepOptions>({
  name: TOUR_STEP_NODE_NAME,
  group: "block",
  atom: true,
  draggable: true,
  selectable: true,
  isolating: true,

  addOptions() {
    return { HTMLAttributes: {}, cardId: "" };
  },

  addAttributes() {
    return {
      [STEP_ATTRIBUTES[0]]: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-step-id"),
        renderHTML: (attributes) =>
          typeof attributes.stepId === "string" && attributes.stepId.length > 0
            ? { "data-step-id": attributes.stepId }
            : {},
      },
      [STEP_ATTRIBUTES[1]]: {
        default: [],
        parseHTML: (element) => parseTargetsAttribute(element.getAttribute("data-targets")),
        renderHTML: (attributes) => ({
          "data-targets": JSON.stringify(attributes.targets ?? []),
        }),
      },
      [STEP_ATTRIBUTES[2]]: {
        default: null,
        parseHTML: (element) => parseViewportAttribute(element.getAttribute("data-viewport")),
        renderHTML: (attributes) =>
          attributes.viewport ? { "data-viewport": JSON.stringify(attributes.viewport) } : {},
      },
      [STEP_ATTRIBUTES[3]]: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-caption"),
        renderHTML: (attributes) =>
          typeof attributes.caption === "string" && attributes.caption.length > 0
            ? { "data-caption": attributes.caption }
            : {},
      },
      [STEP_ATTRIBUTES[4]]: {
        default: "next" satisfies TourStepAttributes["advance"],
        parseHTML: (element) =>
          tourStepAdvanceModes.includes(
            element.getAttribute("data-advance") as TourStepAttributes["advance"],
          )
            ? element.getAttribute("data-advance")
            : "next",
        renderHTML: (attributes) => ({ "data-advance": attributes.advance ?? "next" }),
      },
    };
  },

  parseHTML() {
    return [{ tag: "div[data-tour-step]" }];
  },

  // Copy, export and a publish read as prose, never as an opaque id.
  renderHTML({ node, HTMLAttributes }) {
    const step = stepOfAttributes(node.attrs);
    const label = step?.targets.length
      ? `Tour step → ${step.targets.map((target) => `${target.kind}:${target.id}`).join(", ")}`
      : "Tour step";
    return [
      "div",
      mergeAttributes(
        { "data-tour-step": "" },
        this.options.HTMLAttributes,
        HTMLAttributes,
        this.options.cardId ? { "data-tutorial-id": this.options.cardId } : {},
      ),
      ["span", label],
      ["span", step?.caption ?? ""],
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(TourStepView, {
      // The block owns its inputs (the caption region, its buttons): without
      // this ProseMirror would read their keystrokes and replace the atom.
      stopEvent: () => true,
      // The index badge is the block's position in the body, so the view has to
      // re-render when earlier blocks move.
      trackNodeViewPosition: true,
    });
  },
});
