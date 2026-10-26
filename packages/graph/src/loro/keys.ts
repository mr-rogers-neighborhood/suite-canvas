/**
 * Root map keys a domain module may name. The drawings root stays in the facade
 * alone, so a feature module cannot open it and bypass validation.
 */
export const STRUCT_KEYS = {
  boards: "boards",
  cards: "cards",
  placements: "placements",
  edges: "edges",
  types: "types",
  tags: "tags",
  sections: "sections",
  content: "content",
  titles: "titles",
  references: "references",
  meta: "meta",
  views: "views",
} as const;
