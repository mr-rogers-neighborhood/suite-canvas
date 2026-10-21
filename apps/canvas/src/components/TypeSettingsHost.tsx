import { useCanvasStore } from "../store/useCanvasStore";
import { useUiStore } from "../store/useUiStore";
import { useWorkspaceSnapshot } from "../store/workspaceStore";
import { TypeSettingsDialog } from "./TypeSettingsDialog";

export function TypeSettingsHost() {
  const workspace = useCanvasStore((state) => state.workspace);
  const types = useWorkspaceSnapshot().types;
  const open = useUiStore((state) => state.typeSettingsOpen);
  const close = useUiStore((state) => state.closeTypeSettings);

  if (!open) return null;

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
    />
  );
}
