import type { ReactNode } from "react";

/**
 * A bar that ends a gesture: one sentence about what just happened, then the two things a reader can do about it.
 *
 * There were two of these, and they had drifted the way two copies do: the placement bar inside the reader's panel and the
 * floating bar that holds the board open after a passage lands. They say different things and sit in different places, but
 * the shape — note, quiet action, primary action — is the same shape, so it is one component with a `floating` flag rather
 * than two that will disagree about button sizes in a month.
 *
 * The host keeps its own container: an inline strip in a panel and a pill over the board are different decisions about
 * where the bar belongs, and burying that in a prop would be the drift coming back by another door.
 */
export interface ActionBarAction {
  readonly label: string;
  readonly testId: string;
  readonly onSelect: () => void;
  /** The one thing the bar most wants a reader to do, if it wants one. */
  readonly primary?: boolean;
  readonly title?: string;
}

export interface ActionBarProps {
  readonly testId: string;
  readonly note: ReactNode;
  readonly actions: readonly ActionBarAction[];
  /** True when the bar floats over the board rather than sitting as a strip in a panel. */
  readonly floating?: boolean;
}

export function ActionBar({ testId, note, actions, floating = false }: ActionBarProps) {
  return (
    <div
      className={`action-bar${floating ? " action-bar--floating" : ""}`}
      data-testid={testId}
      role="toolbar"
      aria-label="What is happening"
    >
      <span className="action-bar-note">{note}</span>
      {actions.map((action) => (
        <button
          key={action.testId}
          type="button"
          className={`views-button ${action.primary === true ? "views-button--primary" : "views-button--quiet"}`}
          data-testid={action.testId}
          {...(action.title === undefined ? {} : { title: action.title })}
          onClick={action.onSelect}
        >
          {action.label}
        </button>
      ))}
    </div>
  );
}
