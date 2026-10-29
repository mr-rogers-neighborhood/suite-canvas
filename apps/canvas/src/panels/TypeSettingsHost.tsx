import { useCanvasStore } from "../store/useCanvasStore";
import { useUiStore } from "../store/useUiStore";
import { useWorkspaceSnapshot } from "../store/workspaceStore";
import { TypeSettingsDialog } from "./TypeSettingsDialog";

export function TypeSettingsHost() {
  const workspace = useCanvasStore((state) => state.workspace);
  const types = useWorkspaceSnapshot().types;
  const cards = useWorkspaceSnapshot().cards;
  const open = useUiStore((state) => state.typeSettingsOpen);
  const close = useUiStore((state) => state.closeTypeSettings);
  const openCardFocus = useUiStore((state) => state.openCardFocus);

  if (!open) return null;

  /**
   * The templates the dialog should show for whichever type it has selected, in order.
   *
   * A template whose card is missing or trashed is left out here rather than removed from the
   * document: the list is what the type offers, and a deleted card offers nothing.
   */
  const templatesFor = (typeId: string) => {
    const type = types.find((candidate) => candidate.id === typeId);
    const ids = type?.templateCardIds ?? (type?.templateCardId ? [type.templateCardId] : []);
    return ids.flatMap((id) => {
      const card = cards.find((candidate) => candidate.id === id);
      return card && !card.deletedAt
        ? [{ id: card.id, title: workspace.displayTitle(card.id) }]
        : [];
    });
  };

  /** The cards a type's template could be: the ones already carrying that type. */
  const templateCandidatesFor = (typeId: string) =>
    cards
      .filter((card) => !card.deletedAt && card.typeIds.includes(typeId))
      .map((card) => ({ id: card.id, title: workspace.displayTitle(card.id) }));

  return (
    <TypeSettingsDialog
      types={types}
      onClose={close}
      onCreateType={(input) => workspace.createType(input).id}
      onUpdateType={(id, patch) => workspace.updateType(id, patch)}
      onDeleteType={(id, reassignTo) => workspace.deleteType(id, { reassignTo })}
      onAddField={(typeId, input) => workspace.addField(typeId, input)}
      onUpdateField={(typeId, fieldId, patch) => workspace.updateField(typeId, fieldId, patch)}
      onRemoveField={(typeId, fieldId) => workspace.removeField(typeId, fieldId)}
      onMoveField={(typeId, fieldId, index) => workspace.moveField(typeId, fieldId, index)}
      onAddOption={(typeId, fieldId, label) =>
        workspace.addSelectOption(typeId, fieldId, { label })
      }
      onUpdateOption={(typeId, fieldId, optionId, label) =>
        workspace.updateSelectOption(typeId, fieldId, optionId, { label })
      }
      onRemoveOption={(typeId, fieldId, optionId) =>
        workspace.removeSelectOption(typeId, fieldId, optionId)
      }
      templatesFor={templatesFor}
      templateCandidatesFor={templateCandidatesFor}
      onCreateTemplate={(typeId) => {
        // The template is a real card, so it is created like one and left in the
        // inbox until someone places it. `fromTemplate: false` keeps a template
        // from copying itself.
        const card = workspace.createCard({ typeId, fromTemplate: false });
        // Appended, not replacing: a type can hold several templates, and Create is how
        // another one is added rather than how the existing one is overwritten.
        const existing = templatesFor(typeId).map((entry) => entry.id);
        workspace.updateType(typeId, { templateCardIds: [...existing, card.id] });
        // The editor would sit on top of the card it just opened, so it closes:
        // the next thing the user does is write the template.
        close();
        openCardFocus(card.id);
      }}
      onOpenTemplate={(cardId) => {
        close();
        openCardFocus(cardId);
      }}
      onSetTemplates={(typeId, cardIds) =>
        workspace.updateType(typeId, { templateCardIds: cardIds })
      }
    />
  );
}
