import type { BoardMiniatureModel, MiniatureDot } from "./portalMiniature";
import { miniatureSectionColor } from "./portalMiniature";

export interface BoardMiniatureProps {
  model: BoardMiniatureModel;
  /** Peer dots, already placed in the model's normalised space. */
  dots?: readonly MiniatureDot[];
  /** Accessible name; the portal card passes the target board's name. */
  label: string;
  className?: string;
}

/**
 * A static drawing of one board: section bands, card rectangles and peer dots.
 * Pure SVG so it scales to any frame — the portal card and the camera overlay
 * both animate this same markup instead of mounting a second canvas.
 */
export function BoardMiniature({ model, dots = [], label, className }: BoardMiniatureProps) {
  const { width, height } = model.viewBox;
  return (
    <svg
      data-testid="portal-miniature"
      data-empty={model.empty ? "true" : undefined}
      role="img"
      aria-label={label}
      className={`portal-miniature${className ? ` ${className}` : ""}`}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="xMidYMid meet"
    >
      <rect
        className="portal-miniature__ground"
        x={0}
        y={0}
        width={width}
        height={height}
        rx={1.5}
      />
      {model.links.length > 0 ? (
        <g data-testid="portal-miniature-links">
          {model.links.map((link) => (
            <line
              key={link.edgeId}
              className="portal-miniature__link"
              x1={link.x1}
              y1={link.y1}
              x2={link.x2}
              y2={link.y2}
            />
          ))}
        </g>
      ) : null}
      {model.sections.map((section) => (
        <rect
          key={section.sectionId}
          className="portal-miniature__section"
          data-testid="portal-miniature-section"
          x={section.x}
          y={section.y}
          width={section.width}
          height={section.height}
          rx={1.2}
          fill={miniatureSectionColor(section.color)}
        />
      ))}
      {model.cards.map((card) => (
        <rect
          key={card.cardId}
          className="portal-miniature__card"
          data-testid="portal-miniature-card"
          x={card.x}
          y={card.y}
          width={card.width}
          height={card.height}
          rx={0.8}
        />
      ))}
      {dots.map((dot) => (
        <circle
          key={`${dot.label}:${dot.color}:${dot.x}:${dot.y}`}
          className="portal-miniature__dot"
          data-testid="portal-miniature-dot"
          cx={dot.x}
          cy={dot.y}
          r={2.4}
          fill={dot.color}
        >
          <title>{dot.label}</title>
        </circle>
      ))}
    </svg>
  );
}
