import { ViewportPortal } from "@xyflow/react";
import { endpointAnchor, type LinkAnchor, type LinkScene } from "../links/linkGeometry";
import { useLinkThreadStore } from "../links/linkThread";

/**
 * The next link in a thread, rubber-banding from the armed connector to the
 * pointer. Without it the user clicks into the dark: nothing shows where the
 * line would land until the click that commits it.
 *
 * While the pointer is over a dot the band snaps to it and rings it, so the read is
 * "the line lands *there*" rather than "the line follows the mouse". A thread gets
 * that for free from its moving armed end; a fan does not, because its origin stays
 * put — a fan with no target on screen is a hub with no next spoke showing
 * (ADR-0061).
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
  const target = useLinkThreadStore((state) => state.target);
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

  // A target on the armed connector itself is the cancel click, not a link, so the
  // band keeps following the pointer there.
  const lands =
    target && !(target.id === endpoint.id && target.connectorId === endpoint.connectorId)
      ? endpointAnchor(
          { kind: target.kind, id: target.id, connectorId: target.connectorId },
          boardId,
          scene,
          cursor,
        )
      : null;
  const to = lands ?? cursor;

  return (
    <ViewportPortal>
      <svg
        className="section-link-preview-layer"
        data-testid="thread-link-preview"
        data-snapped={lands ? "true" : "false"}
        aria-hidden="true"
        focusable="false"
      >
        <line className="section-link-preview" x1={from.x} y1={from.y} x2={to.x} y2={to.y} />
        <circle className="section-link-preview__origin" cx={from.x} cy={from.y} r={4} />
        {lands ? (
          <circle className="section-link-preview__target" cx={to.x} cy={to.y} r={7} />
        ) : null}
      </svg>
    </ViewportPortal>
  );
}
