import { DEFAULT_PALETTE, type PaletteSwatch, paletteSwatchSchema } from "../style.js";
import { cleanWorkspaceName, DEFAULT_WORKSPACE_NAME, STRUCT_ORIGIN } from "./constants.js";
import type { DocContext } from "./context.js";

/**
 * Owns the workspace's own meta: name, seeding, and the home and new-tab board. These
 * live in the `meta` map, not in a snapshot section, so they are not part of what a
 * board shows.
 *
 * Plain functions over the shared DocContext: the facade delegates here,
 * and modules reach each other through `ctx.api`.
 */
export function workspaceMethods(ctx: DocContext) {
  return {
    hasSeeded(): boolean {
      return ctx.meta.get("seeded") === true;
    },

    markSeeded(): void {
      ctx.meta.set("seeded", true);
      ctx.commit(`${STRUCT_ORIGIN}seed`);
    },

    /** True when the document stores a name of its own, not a derived fallback. */
    hasWorkspaceName(): boolean {
      const stored = ctx.meta.get("name");
      return typeof stored === "string" && stored.trim().length > 0;
    },

    /**
     * The workspace's own name. A document from before workspace names existed
     * borrows its first board's name, so it never renders blank; "Untitled
     * workspace" is the last resort.
     */
    workspaceName(): string {
      const stored = ctx.meta.get("name");
      if (typeof stored === "string") {
        const trimmed = stored.trim();
        if (trimmed.length > 0) return trimmed;
      }
      const first = ctx.api.boards.listBoards()[0]?.name.trim();
      return first && first.length > 0 ? first : DEFAULT_WORKSPACE_NAME;
    },

    /** Renames the workspace; a name that fails validation throws its reason. */
    renameWorkspace(name: string): void {
      const trimmed = cleanWorkspaceName(name);
      if (ctx.meta.get("name") === trimmed) return;
      ctx.meta.set("name", trimmed);
      ctx.commit(`${STRUCT_ORIGIN}rename-workspace`);
    },

    /**
     * The board a workspace opens when nothing else is open — "home"
     * (ADR-0040,
     * gate A24). Stored as the board id rather than a flag on the board: a board can be
     * deleted while a second one is home, and one key is one truth to clear.
     */
    workspaceHomeBoardId(): string | null {
      return ctx.api.workspace.navigationBoard("homeBoardId");
    },

    /** Names the home board, or clears it when the id is null or no longer a board. */
    setWorkspaceHomeBoardId(boardId: string | null): void {
      ctx.api.workspace.setNavigationBoard("homeBoardId", boardId);
    },

    /**
     * The board a new tab opens, when the reader has one they always want. Absent
     * means a new tab asks which board instead of guessing.
     */
    newTabBoardId(): string | null {
      return ctx.api.workspace.navigationBoard("newTabBoardId");
    },

    setNewTabBoardId(boardId: string | null): void {
      ctx.api.workspace.setNavigationBoard("newTabBoardId", boardId);
    },

    /** A stored board reference, dropped if the board it names has since gone. */
    navigationBoard(key: "homeBoardId" | "newTabBoardId"): string | null {
      const stored = ctx.meta.get(key);
      if (typeof stored !== "string" || stored.length === 0) return null;
      return ctx.api.boards.getBoard(stored) ? stored : null;
    },

    setNavigationBoard(key: "homeBoardId" | "newTabBoardId", boardId: string | null): void {
      const next = boardId !== null && ctx.api.boards.getBoard(boardId) ? boardId : null;
      if (ctx.meta.get(key) === next) return;
      if (next === null) ctx.meta.delete(key);
      else ctx.meta.set(key, next);
      ctx.commit(`${STRUCT_ORIGIN}set-${key}`);
    },

    /**
     * The workspace palette. Document data: a share renders the author's colours,
     * and every swatch carries both modes, so a visitor's light/dark choice still
     * works inside somebody else's colours.
     *
     * A workspace that has never been edited answers with the defaults rather than
     * an empty list, so the first swatch a reader clicks already exists.
     */
    palette(): PaletteSwatch[] {
      const stored = ctx.meta.get("palette");
      if (!Array.isArray(stored)) return [...DEFAULT_PALETTE];
      const palette: PaletteSwatch[] = [];
      for (const entry of stored) {
        const parsed = paletteSwatchSchema.safeParse(entry);
        if (parsed.success) palette.push(parsed.data);
      }
      return palette.length > 0 ? palette : [...DEFAULT_PALETTE];
    },

    /** Replaces the whole palette; an empty list restores the defaults. */
    setPalette(palette: readonly PaletteSwatch[]): void {
      if (palette.length === 0) {
        if (ctx.meta.get("palette") !== undefined) ctx.meta.delete("palette");
        ctx.commit(`${STRUCT_ORIGIN}set-palette`);
        return;
      }
      ctx.meta.set(
        "palette",
        palette.map((entry) => paletteSwatchSchema.parse(entry)),
      );
      ctx.commit(`${STRUCT_ORIGIN}set-palette`);
    },

    /**
     * Notifies when the workspace's own meta changes.
     * Meta is not a snapshot section, so its readers take their own subscription
     * rather than a second snapshot field.
     */
    observeWorkspaceMeta(listener: () => void): () => void {
      ctx.metaListeners.add(listener);
      return () => {
        ctx.metaListeners.delete(listener);
      };
    },
  };
}
