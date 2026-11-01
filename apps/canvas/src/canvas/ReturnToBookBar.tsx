import { IconGlyph } from "../icons/IconGlyph";
import { useEscapeLayer } from "../shell/escapeLayers";
import { useUiStore } from "../store/useUiStore";
import { usePlaceStackStore } from "./placeStack";

/**
 * The choice that ends placing a passage on the board.
 *
 * A stack picked up from a book used to hand the reader straight back to it: the focus surface un-concealed the moment
 * the queue emptied, so a card that landed a little to the left of where they meant it was already out of reach. This
 * bar holds that moment open. The board stays usable, so the card can be nudged or resized, and the reader says when
 * they are done.
 *
 * **Escape is the same as Return to book**, because that is what a reader means by it here, and because a bar that is
 * the only way out of a mode is a bar that traps somebody who does not see it.
 *
 * It appears only for a stack that came from a book: the library's own Place cards ends at the board, which is where the
 * reader already is.
 */
export function ReturnToBookBar() {
  const fromBook = usePlaceStackStore((state) => state.fromBook);
  const toPlace = usePlaceStackStore((state) => state.queue.length);
  const stop = usePlaceStackStore((state) => state.stop);
  const openCardFocus = useUiStore((state) => state.openCardFocus);
  const requestBookPanel = useUiStore((state) => state.requestBookPanel);

  /** Back to the book, at the passage list, which is where a reader placing several came from. */
  const goBack = () => {
    if (fromBook === null) return;
    openCardFocus(fromBook);
    requestBookPanel("highlights");
    stop();
  };

  // Escape belongs to this bar while it is up: the top layer of the stack is the most recently opened surface.
  useEscapeLayer(goBack, fromBook !== null && toPlace === 0);

  if (fromBook === null || toPlace > 0) return null;

  return (
    <div className="return-to-book" data-testid="return-to-book" role="toolbar" aria-label="Placed">
      <span className="return-to-book-done">
        <IconGlyph icon="lucide:check" size={12} />
        Placed. You can arrange the cards or return to the book now.
      </span>
      <button
        type="button"
        className="views-button views-button--quiet"
        data-testid="return-to-book-more"
        onClick={() => {
          if (fromBook === null) return;
          openCardFocus(fromBook);
          requestBookPanel("highlights");
          stop();
        }}
      >
        Place more annotations
      </button>
      <button
        type="button"
        className="views-button views-button--primary"
        data-testid="return-to-book-go"
        onClick={goBack}
      >
        Return to book
      </button>
    </div>
  );
}
