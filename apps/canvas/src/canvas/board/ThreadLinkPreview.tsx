import { ViewportPortal } from "@xyflow/react";
import { endpointAnchor, type LinkAnchor, type LinkScene } from "../links/linkGeometry";

/**
 * The next link in a thread, rubber-banding from the armed connector to the
 * pointer. Without it the user clicks into the dark: nothing shows where the
 * line would land until the click that commits it.
 */
export function ThreadLinkPreview({
  endpoint,
  cursor,
  scene,
  boardId,
}: {
  endpoint: { kind: string; id: string; connectorId: string };
  cursor: LinkAnchor;
  scene: LinkScene;
  boardId: string;
}) {
  const from = endpointAnchor(
    {
      kind: endpoint.kind === "section" ? "section" : "card",
      id: endpoint.id,
      connectorId: endpoint.connectorId,
    },
    boardId,
    scene,
    cursor,
  );
  if (!from) return null;

  return (
    <ViewportPortal>
      <svg
        className="section-link-preview-layer"
        data-testid="thread-link-preview"
        aria-hidden="true"
        focusable="false"
      >
        <line
          className="section-link-preview"
          x1={from.x}
          y1={from.y}
          x2={cursor.x}
          y2={cursor.y}
        />
        <circle className="section-link-preview__origin" cx={from.x} cy={from.y} r={4} />
      </svg>
    </ViewportPortal>
  );
}
