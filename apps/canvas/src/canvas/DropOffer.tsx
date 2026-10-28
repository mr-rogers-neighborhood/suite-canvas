import { useEscapeLayer } from "../shell/escapeLayers";
import { useCanvasStore } from "../store/useCanvasStore";
import { useUiStore } from "../store/useUiStore";

/**
 * What a link released over empty canvas is offered.
 *
 * A drag that ends nowhere used to discard the whole gesture, which is the one outcome
 * a reader never wants: they were drawing a relationship and the far end has no card yet.
 * So the release asks, and nothing is created until it is answered — a mis-drop must not
 * leave a card behind.
 */
export function DropOffer() {
  const offer = useUiStore((state) => state.dropOffer);
  const setDropOffer = useUiStore((state) => state.setDropOffer);
  const workspace = useCanvasStore((state) => state.workspace);
  const activeBoardId = useUiStore((state) => state.activeBoardId);
  const setSelectedNodeIds = useUiStore((state) => state.setSelectedNodeIds);
  const startEditing = useUiStore((state) => state.startEditing);
  const canCreateContent = useUiStore((state) => state.canCreateContent);

  const close = () => setDropOffer(null);
  useEscapeLayer(close, offer !== null);

  if (!offer) return null;

  /** The card the offer creates, linked back through the dot the gesture started on. */
  const create = (mode: "here" | "library") => {
    if (!canCreateContent || !activeBoardId) {
      close();
      return;
    }
    const card = workspace.createCard(
      // A card "to the library" names no board and no position: an unplaced card is
      // exactly what the library lists, and placing one would defeat the choice.
      mode === "here" ? { boardId: activeBoardId, position: offer.point } : {},
    );
    workspace.addEdge({
      boardId: activeBoardId,
      source: offer.from.nodeId,
      sourceConnector: offer.from.connectorId,
      target: card.id,
    });
    setSelectedNodeIds([card.id]);
    close();
    if (mode === "here") startEditing(card.id, "title");
  };

  return (
    <>
      {/* A press anywhere else is a dismissal, exactly like the canvas menus. */}
      <button
        type="button"
        aria-label="Dismiss"
        className="drop-offer__scrim"
        onClick={close}
        onPointerDown={(event) => event.stopPropagation()}
      />
      <div
        className="drop-offer"
        role="menu"
        data-testid="drop-offer"
        aria-label="Finish this link"
        style={{ left: `${offer.x}px`, top: `${offer.y}px` }}
      >
        <button
          type="button"
          role="menuitem"
          className="drop-offer__item"
          data-testid="drop-offer-card"
          onClick={() => create("here")}
        >
          Add a card here
        </button>
        <button
          type="button"
          role="menuitem"
          className="drop-offer__item"
          data-testid="drop-offer-library"
          onClick={() => create("library")}
        >
          Add a card to the library
        </button>
      </div>
    </>
  );
}
