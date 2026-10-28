/**
 * The kinds of thing a reader can select.
 *
 * One vocabulary for the inspector and the menus: a section or a menu row declares the
 * kinds it serves, and a surface keeps only what serves everything it is describing.
 * A portal is a card drawn as a door, but it is its own kind here because it has no body
 * and no types — the two things that decide what an inspector has to show.
 */
export type EntityKind = "card" | "portal" | "section" | "edge" | "connector" | "canvas";
