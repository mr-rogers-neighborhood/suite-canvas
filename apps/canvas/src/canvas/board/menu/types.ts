import type { LayerAction } from "@suite/graph";
import type { ContextMenuItem } from "../../../dialogs/ContextMenu";
import type { ContextMenuState } from "../../../store/useUiStore";
import type { AlignEdge, DistributeAxis } from "../../interactions/arrangeCommand";
import type { useBoardProjection } from "../useBoardProjection";
import type { useBoardUi } from "../useBoardUi";

/** What a board context menu can show, and what each item does. */
export interface BoardMenuContext {
  menu: ContextMenuState;
  workspace: ReturnType<typeof useBoardUi>["workspace"];
  activeBoardId: string | null;
  boards: { id: string; name: string }[];
  cardsById: ReturnType<typeof useBoardProjection>["cardsById"];
  sectionMembershipMap: Map<string, string>;
  selectedNodeIds: string[];
  store: ReturnType<typeof useBoardUi>["store"];
  mode: ReturnType<typeof useBoardUi>["mode"];
  setMode: ReturnType<typeof useBoardUi>["setMode"];
  canCreateContent: boolean;
  canEditLayout: boolean;
  canCreateBoards: boolean;
  canManageTrash: boolean;
  canManageStructure: boolean;
  canManageLinks: boolean;
  requestShare: ReturnType<typeof useBoardUi>["requestShare"];
  createNoteAt: (position: { x: number; y: number }) => void;
  createWhiteboardAt: (position: { x: number; y: number }) => void;
  createSectionAt: (position: { x: number; y: number }, wrapSelection?: boolean) => void;
  createPortalAt: (position: { x: number; y: number }, targetBoardId: string) => void;
  createPortalToNewBoard: (position: { x: number; y: number }) => void;
  duplicateCards: (ids: string[]) => void;
  moveCardToBoard: (cardId: string, boardId: string) => void;
  otherBoards: (boardId: string | null) => { id: string; name: string }[];
  changeLayer: (nodeId: string, action: LayerAction) => void;
  changeLayerBulk: (ids: string[], action: LayerAction) => void;
  arrangeSelection: (kind: "align" | "distribute", value: AlignEdge | DistributeAxis) => void;
  unplaceSelected: () => void;
  trashSelected: () => void;
  startEdgeDescription: (edgeId: string, point: { x: number; y: number }) => void;
  enterPortal: (nodeId: string, targetBoardId: string) => void;
  setSelectedNodeIds: ReturnType<typeof useBoardUi>["setSelectedNodeIds"];
  setSelectedConnector: ReturnType<typeof useBoardUi>["setSelectedConnector"];
  setSelectedSectionConnector: (
    connector: { sectionId: string; connectorId: string } | null,
  ) => void;
  setEditingSection: ReturnType<typeof useBoardUi>["setEditingSection"];
  selectSection: ReturnType<typeof useBoardUi>["selectSection"];
}

export type MenuBranch = (ctx: BoardMenuContext) => ContextMenuItem[] | null;
