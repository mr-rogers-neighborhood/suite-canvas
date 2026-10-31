import type { ReactNode } from "react";

/**
 * The layer's two smallest controls.
 *
 * Every chip in the layer, the context drawer, the surface controls and the projection float is the same
 * object with three states: quiet, pressed, and disabled. They were eleven class strings copy-pasted across
 * four files before this; one component means a change to what "pressed" looks like is one edit, and a
 * screen reader hears the same thing everywhere.
 */
export interface ChipProps {
  children: ReactNode;
  pressed?: boolean | undefined;
  /** A chip that does something rather than a chip that names a current state. */
  action?: boolean | undefined;
  disabled?: boolean | undefined;
  title?: string | undefined;
  className?: string | undefined;
  testId?: string | undefined;
  onClick?: (() => void) | undefined;
  /** The count a chip carries on its right, drawn dimmer than its label. */
  count?: number | undefined;
}

export function Chip({
  children,
  pressed,
  action = false,
  disabled = false,
  title,
  className,
  testId,
  onClick,
  count,
}: ChipProps) {
  const classes = ["views-chip", className ?? ""].filter(Boolean).join(" ");
  return (
    <button
      type="button"
      className={classes}
      data-testid={testId}
      title={title}
      disabled={disabled}
      aria-pressed={pressed === undefined ? undefined : pressed}
      data-action={action ? "true" : undefined}
      onClick={onClick}
    >
      {children}
      {count === undefined ? null : <span className="views-chip-count">{count}</span>}
    </button>
  );
}

export interface SegmentedOption<T extends string> {
  readonly value: T;
  readonly label: string;
  readonly title?: string | undefined;
  readonly icon?: ReactNode | undefined;
}

export interface SegmentedProps<T extends string> {
  /** Named for the screen reader; the control itself shows no label of its own. */
  label: string;
  value: T;
  options: readonly SegmentedOption<T>[];
  onChange: (value: T) => void;
  className?: string | undefined;
  /** `prefix` names each button's test id, so a suite can press one without a label lookup. */
  testIdPrefix?: string | undefined;
}

/**
 * One of N, as a single tab stop.
 *
 * `role="radiogroup"` rather than a set of pressed buttons: choosing a kind or a presentation replaces the
 * previous answer instead of adding to it, and arrow keys are what a reader expects in that shape.
 */
export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  className,
  testIdPrefix,
}: SegmentedProps<T>) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={["views-segmented", className ?? ""].filter(Boolean).join(" ")}
    >
      {options.map((option) => (
        // A radio is the right role rather than a set of pressed buttons: choosing replaces the answer.
        // biome-ignore lint/a11y/useSemanticElements: a real input cannot carry an icon and a title the way a button does.
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={option.value === value}
          aria-label={option.label}
          title={option.title ?? option.label}
          className="views-segmented-option"
          data-testid={testIdPrefix === undefined ? undefined : `${testIdPrefix}-${option.value}`}
          onClick={() => onChange(option.value)}
        >
          {option.icon ?? option.label}
        </button>
      ))}
    </div>
  );
}
