import type { Card } from "@suite/graph";
import { useCanvasStore } from "../store/useCanvasStore";
import { ViewFigure } from "./ViewFigure";
import { viewIdOf } from "./viewCard";

/**
 * The face of a view card: the saved view it names, drawn.
 *
 * Its own component so the card body stays a switch between faces rather than a third
 * branch inside the card. The card stores only the view id, so this looks the view up
 * every render: a renamed or re-filtered view shows its new self everywhere at once.
 */
export function ViewCardFace({ card }: { card: Card }) {
  const workspace = useCanvasStore((state) => state.workspace);
  const viewId = workspace === null ? null : viewIdOf(card, workspace);
  return (
    <div className="min-h-[120px] p-2">
      <ViewFigure
        view={viewId === null ? undefined : workspace?.getView(viewId)}
        workspace={workspace as NonNullable<typeof workspace>}
      />
    </div>
  );
}
