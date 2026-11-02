import { ActionBar } from "../chrome/ActionBar";
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

  /**
   * Back to the book, at the reader's own place.
   *
   * No panel: "return to book" means the page they were on, not the list of everything they have marked. The two buttons
   * here used to run this same call, so the choice the bar exists to offer was not a choice at all.
   */
  const returnToBook = () => {
    if (fromBook === null) return;
    openCardFocus(fromBook);
    stop();
  };

  /**
   * Back to the book with its passage list open, which is where a reader placing several came from and where the next
   * batch is ticked.
   */
  const placeMore = () => {
    if (fromBook === null) return;
    openCardFocus(fromBook);
    requestBookPanel("highlights");
    stop();
  };

  // Escape belongs to this bar while it is up: the top layer of the stack is the most recently opened surface.
  useEscapeLayer(returnToBook, fromBook !== null && toPlace === 0);

  if (fromBook === null || toPlace > 0) return null;

  return (
    <ActionBar
      testId="return-to-book"
      floating
      note={
        <>
          <IconGlyph icon="lucide:check" size={12} />
          Placed. Arrange the cards, or go back.
        </>
      }
      actions={[
        {
          label: "Place more annotations",
          testId: "return-to-book-more",
          title: "Back to the book with your highlights open",
          onSelect: placeMore,
        },
        {
          label: "Return to book",
          testId: "return-to-book-go",
          title: "Back to the page you were reading",
          primary: true,
          onSelect: returnToBook,
        },
      ]}
    />
  );
}
