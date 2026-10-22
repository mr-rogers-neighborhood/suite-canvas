import { EMPTY_VALUE_TEXT, type TemplateContext, templateSegments } from "@suite/graph";
import type { ReactNode } from "react";

export interface ValueTemplateProps {
  /** The template to render; `displayTemplate(field)` supplies the default. */
  template: string;
  context: TemplateContext;
  /** Extra class for the value segments, so a chip can style the value alone. */
  valueClassName?: string;
  labelClassName?: string;
  /** Marks the em dash so a surface can style an empty value differently. */
  emptyClassName?: string;
  /**
   * Id for the value segment itself — the thing a test or a reader cares about.
   * The wrapper takes `${testId}-template`.
   */
  testId?: string;
  /**
   * Renders the value itself instead of its text: an editable body block puts
   * its input here, so one template describes both the label and the control.
   */
  renderValue?: ReactNode;
}

/**
 * Renders one value through its display template. Label segments stay muted and
 * value segments carry the value's own styling, so a template reads as a label
 * and a value rather than as a flat string — which is what made the old chip
 * readable at a glance.
 *
 * This is the only place a template becomes pixels; chips, body blocks and
 * future rollups all call it so one stored style cannot render two ways.
 */
export function ValueTemplate({
  template,
  context,
  valueClassName = "value-template__value",
  labelClassName = "value-template__label",
  emptyClassName = "value-template__empty",
  testId,
  renderValue,
}: ValueTemplateProps) {
  return (
    <span className="value-template" data-testid={testId ? `${testId}-template` : undefined}>
      {templateSegments(template).map((segment, index) => {
        const key = `${index}:${segment.kind}`;
        if (segment.kind === "literal") {
          return (
            <span key={key} className="value-template__literal">
              {segment.text}
            </span>
          );
        }
        if (segment.kind === "value") {
          const empty = context.value.length === 0;
          return (
            <span
              key={key}
              className={empty ? `${valueClassName} ${emptyClassName}` : valueClassName}
              data-testid={testId}
              data-empty={empty ? "true" : undefined}
            >
              {renderValue ?? (empty ? EMPTY_VALUE_TEXT : context.value)}
            </span>
          );
        }
        if (segment.kind === "label") {
          return (
            <span key={key} className={labelClassName}>
              {context.label}
            </span>
          );
        }
        return (
          <span key={key} className="value-template__ref">
            {context[segment.kind]}
          </span>
        );
      })}
    </span>
  );
}
