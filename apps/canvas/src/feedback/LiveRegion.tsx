import { useAnnouncerStore } from "./announcer";

/**
 * The two regions every announcement goes through.
 *
 * `aria-atomic` is on so a reader repeats the whole sentence rather than the
 * changed word. Both regions are always mounted: a live region inserted at the
 * same moment as its text is usually missed.
 */
function spoken(message: string, id: number): string {
  // A repeat has to differ from the text already in the region to be spoken.
  return id % 2 === 1 ? `${message}\u200B` : message;
}

export function LiveRegion() {
  const polite = useAnnouncerStore((state) => state.polite);
  const assertive = useAnnouncerStore((state) => state.assertive);

  return (
    <>
      <p
        className="sr-only"
        data-testid="live-region-polite"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {polite === null ? "" : spoken(polite.message, polite.id)}
      </p>
      <p
        className="sr-only"
        data-testid="live-region-assertive"
        role="alert"
        aria-live="assertive"
        aria-atomic="true"
      >
        {assertive === null ? "" : spoken(assertive.message, assertive.id)}
      </p>
    </>
  );
}
