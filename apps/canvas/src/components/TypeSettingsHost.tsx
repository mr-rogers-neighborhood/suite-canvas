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

  /** The template the dialog should show for whichever type it has selected. */
  const templateFor = (typeId: string) => {
    const templateId = types.find((candidate) => candidate.id === typeId)?.templateCardId;
    if (!templateId) return undefined;
    const card = cards.find((candidate) => candidate.id === templateId);
    return card ? { id: card.id, title: workspace.displayTitle(card.id) } : undefined;
  };

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
      templateFor={templateFor}
      onCreateTemplate={(typeId) => {
        // The template is a real card, so it is created like one and left in the
        // inbox until someone places it. `fromTemplate: false` keeps a template
        // from copying itself.
        const card = workspace.createCard({ typeId, fromTemplate: false });
        workspace.updateType(typeId, { templateCardId: card.id });
        // The editor would sit on top of the card it just opened, so it closes:
        // the next thing the user does is write the template.
        close();
        openCardFocus(card.id);
      }}
      onOpenTemplate={(cardId) => {
        close();
        openCardFocus(cardId);
      }}
      onClearTemplate={(typeId) => workspace.updateType(typeId, { templateCardId: null })}
    />
  );
}
