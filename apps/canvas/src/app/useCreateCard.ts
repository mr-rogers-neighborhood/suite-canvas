import type { WorkspaceDocument } from "@suite/graph";
import { useCallback, useState } from "react";
import type { TemplateChoice } from "../cards/TemplateChoiceMenu";
import { WHITEBOARD_TYPE_ID } from "../cards/whiteboard";

/**
 * The one path from "new card of this type" to a card on the board.
 *
 * The dock, the command palette, the library and the card type picker all land here, which is
 * what keeps a type's templates from growing four different menus. A type with two or more
 * live templates cannot answer "what does a new card look like" by itself, so the question is
 * asked once, in one chooser; with none, or one, the card is simply made and the template the
 * type names is copied.
 *
 * The choice is state rather than a promise: the menu is a real surface that the shell renders,
 * and `pick` is what the reader's answer calls back into.
 */
export function useCreateCard(args: {
  workspace: WorkspaceDocument;
  activeBoardId: string | null;
  canvasPoint: (point?: { x: number; y: number }) => { x: number; y: number };
  startEditing: (cardId: string, field: "title" | "body") => void;
  openCardFocus: (cardId: string) => void;
}) {
  const { workspace, activeBoardId, canvasPoint, startEditing, openCardFocus } = args;
  const [choice, setChoice] = useState<TemplateChoice | null>(null);

  const create = useCallback(
    (typeId: string, point?: { x: number; y: number }, templateId?: string | null) => {
      if (!activeBoardId) return undefined;
      const position = point ? canvasPoint(point) : canvasPoint();
      const card = workspace.createCard({
        typeId,
        boardId: activeBoardId,
        position,
        // `null` is the reader asking for a blank card while the type has templates.
        ...(templateId === null ? { fromTemplate: false } : {}),
        ...(templateId ? { templateId } : {}),
      });
      // A sketch is drawn, not titled: it opens on its surface. Asking for a title
      // edit started an editor a sketch does not have on the canvas, so the press
      // made a blank card and nothing else.
      if (typeId === WHITEBOARD_TYPE_ID) openCardFocus(card.id);
      else startEditing(card.id, "title");
      return card.id;
    },
    [activeBoardId, canvasPoint, workspace, startEditing, openCardFocus],
  );

  const createCard = useCallback(
    (typeId: string, point?: { x: number; y: number }) => {
      const templates = workspace.templateCards(typeId);
      if (templates.length > 1) {
        setChoice({
          typeId,
          typeName: workspace.getType(typeId)?.name ?? "card",
          templates: templates.map((template) => ({
            id: template.id,
            title: workspace.displayTitle(template.id),
          })),
          ...(point ? { point } : {}),
        });
        return undefined;
      }
      return create(typeId, point);
    },
    [create, workspace],
  );

  /** The reader's answer: a template by id, or `null` for the blank card. */
  const pick = useCallback(
    (templateId: string | null) => {
      const pending = choice;
      setChoice(null);
      if (pending) create(pending.typeId, pending.point, templateId);
    },
    [choice, create],
  );

  const cancel = useCallback(() => setChoice(null), []);

  return { createCard, choice, pick, cancel };
}
