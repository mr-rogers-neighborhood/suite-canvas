import { useEffect, useMemo } from "react";
import { cardReferences } from "../cards/cardReferences";
import { useCardTitle } from "../hooks/useCardContainers";
import { useCanvasStore } from "../store/useCanvasStore";
import { useUiStore } from "../store/useUiStore";
import { useWorkspaceSnapshot } from "../store/workspaceStore";
import { CardInspector } from "./CardInspector";

/**
 * Binds the inspector panel to the workspace. Kept out of `CardInspector` so the
 * presentation stays testable with plain props.
 */
export function CardInspectorHost() {
  const workspace = useCanvasStore((state) => state.workspace);
  const snapshot = useWorkspaceSnapshot();
  const activeBoardId = useUiStore((state) => state.activeBoardId);
  const inspectorNodeId = useUiStore((state) => state.inspectorNodeId);
  const closeInspector = useUiStore((state) => state.closeInspector);
  const openTypeSettings = useUiStore((state) => state.openTypeSettings);
  const setActiveBoardId = useUiStore((state) => state.setActiveBoardId);

  const card = inspectorNodeId
    ? snapshot.cards.find((entry) => entry.id === inspectorNodeId)
    : undefined;
  const title = useCardTitle(card?.id ?? "");

  useEffect(() => {
    if (inspectorNodeId && !card) closeInspector();
  }, [inspectorNodeId, card, closeInspector]);

  const references = useMemo(
    () => cardReferences(snapshot.boards, snapshot.placements, activeBoardId),
    [snapshot.boards, snapshot.placements, activeBoardId],
  );

  // Cheap: one lookup per type on the card, and the snapshot re-renders this
  // panel whenever a field definition changes.
  const fields = card ? workspace.viewCardFields(card) : [];

  if (!card) return null;

  return (
    <CardInspector
      card={card}
      title={title}
      types={snapshot.types}
      tags={snapshot.tags}
      fields={fields}
      references={references.get(card.id) ?? []}
      onClose={closeInspector}
      onSetType={(typeId) => workspace.setCardTypes(card.id, [typeId], typeId)}
      onAddTag={(tagId) => workspace.addCardTag(card.id, tagId)}
      onRemoveTag={(tagId) => workspace.removeCardTag(card.id, tagId)}
      onCreateTag={(name) => {
        const tag = workspace.ensureTag(name);
        workspace.addCardTag(card.id, tag.id);
      }}
      onSetProperty={(fieldId, value) => workspace.setProperty(card.id, fieldId, value)}
      onClearProperty={(fieldId) => workspace.clearProperty(card.id, fieldId)}
      onManageTypes={openTypeSettings}
      onGoToBoard={setActiveBoardId}
      onRemoveFromBoard={() => {
        if (activeBoardId) workspace.unplaceCard(activeBoardId, card.id);
      }}
    />
  );
}
