import { defaultConnectors, type WorkspaceDocument } from "@suite/graph";
import type { Dispatch, SetStateAction } from "react";
import { useEffect, useRef } from "react";
import { DEFAULT_CARD_WIDTH } from "../canvas/interactions/multiSelect";
import type { FocusState } from "../collab/presence";
import { TAB_ID } from "../collab/tabId";
import { markBoot, measureBoot } from "../dev/bootTiming";
import type { WorkspaceSnapshot } from "../hooks/snapshotMerge";
import type { ShareSession } from "../session/session";
import { friendlyWorkspaceName, readWorkspaceNames } from "../session/workspaceName";
import { rememberWorkspace } from "../session/workspaceTransfer";
import { resolveBoardId, useCanvasStore } from "../store/useCanvasStore";

/**
 * The effects that turn a created document into a usable workspace: connect,
 * wait for the first sync, seed once, resolve the board, and keep the URL and
 * the recents mirror in step. Split from the shell so the render component does
 * not own the ordering rules.
 */
export function useWorkspaceBoot(args: {
  workspace: WorkspaceDocument;
  workspaceId: string;
  workspaceName: string;
  setWorkspaceName: Dispatch<SetStateAction<string>>;
  snapshot: WorkspaceSnapshot;
  share: ShareSession | null;
  readOnly: boolean;
  ready: boolean;
  synced: boolean;
  standalone: boolean;
  activeBoardId: string | null;
  setActiveBoardId: (id: string | null) => void;
  homeBoardId: string | null;
  connect: () => void;
  provider: unknown;
  presence: unknown;
  bindPresence: (presence: never, tabId: string) => void;
  setBoard: (boardId: string | null) => void;
  editingNodeId: string | null;
  editingField: "title" | "body";
  setFocus: (focus: FocusState | null) => void;
  openInspector: (id: string) => void;
}): void {
  const {
    workspace,
    workspaceId,
    workspaceName,
    setWorkspaceName,
    snapshot,
    share,
    readOnly,
    ready,
    synced,
    standalone,
    activeBoardId,
    setActiveBoardId,
    homeBoardId,
    connect,
    provider,
    presence,
    bindPresence,
    setBoard,
    editingNodeId,
    editingField,
    setFocus,
    openInspector,
  } = args;
  const shareCardOpened = useRef(false);

  useEffect(() => {
    if (standalone) return;
    connect();
  }, [connect, standalone]);

  useEffect(() => {
    if (standalone) {
      // Nothing will sync in this build, so the relay's 5 s grace period would
      // only delay the first seed of a local workspace.
      if (!useCanvasStore.getState().synced) useCanvasStore.setState({ synced: true });
      return;
    }
    if (provider) bindPresence(presence as never, TAB_ID);
  }, [bindPresence, presence, provider, standalone]);

  // Seeding is once per workspace, so deleting every card stays deleted. It also
  // waits for the first server sync: seeding an empty local doc would resurrect
  // starter cards in a workspace someone emptied on another client.
  useEffect(() => {
    // A share reads a projection the owner's workspace already seeded; writing
    // in a share room (even the idempotent type repair) belongs to the draft,
    // not to this page's boot.
    if (share || readOnly || !ready || !synced) return;
    // Starter types are structural, not sample data: every workspace has them,
    // and the note type is the fallback for cards with no type.
    workspace.ensureDefaultTypes();
    if (!workspace.hasSeeded()) {
      const board = workspace.ensureBoard();
      // A direct URL can create the first document without the launcher, so
      // the friendly default is applied here too; an existing name always wins.
      if (!workspace.hasWorkspaceName()) {
        workspace.renameWorkspace(friendlyWorkspaceName());
        setWorkspaceName(workspace.workspaceName());
      }
      // A workspace created from the launcher starts blank; older workspaces
      // keep the two-card demo they were seeded with.
      const fresh = new URLSearchParams(window.location.search).get("fresh") === "1";
      if (!fresh && workspace.listCards().length === 0) {
        // Connector ids are derived from the card id, not random. Two clients
        // opening the same new workspace both seed it; the cards carry fixed ids
        // and converge, so random dot ids would union into eight connectors on
        // one card instead of four.
        const starters = (cardId: string) =>
          defaultConnectors().map((connector, index) => ({
            ...connector,
            id: `${cardId}-connector-${index + 1}`,
          }));
        workspace.createCard({
          id: "starter-1",
          boardId: board.id,
          position: { x: 0, y: 0 },
          connectors: starters("starter-1"),
        });
        // One card width plus a gap, so the two starters read as two cards and a
        // section drawn around the first does not reach into the second.
        workspace.createCard({
          id: "starter-2",
          boardId: board.id,
          position: { x: DEFAULT_CARD_WIDTH + 192, y: 0 },
          connectors: starters("starter-2"),
        });
      }
      workspace.markSeeded();
    }
    // The reference index is derived, so repairing it is safe and idempotent. It
    // runs after the first sync so mentions that arrived offline are indexed too.
    workspace.ensureReferences();
  }, [ready, synced, workspace, readOnly, share, setWorkspaceName]);

  useEffect(() => {
    document.title = `${workspaceName} — Suite`;
  }, [workspaceName]);

  useEffect(() => {
    if (!ready) return;
    markBoot("shell:ready");
    measureBoot("to-ready", "store:created", "shell:ready");
  }, [ready]);

  // The launcher may have named this workspace before its document existed.
  // Adopt that mirror once, and only when the document has no name of its own.
  useEffect(() => {
    if (!ready || !synced || share || readOnly || workspace.hasWorkspaceName()) return;
    const mirror = readWorkspaceNames()[workspaceId]?.trim();
    if (!mirror) return;
    try {
      workspace.renameWorkspace(mirror);
      setWorkspaceName(workspace.workspaceName());
    } catch {
      // A name that no longer validates stays in the mirror; the document keeps
      // its derived label rather than failing the boot.
    }
  }, [ready, synced, share, readOnly, workspace, workspaceId, setWorkspaceName]);

  // Resolve the board from the URL, falling back to the first one.
  useEffect(() => {
    if (!ready || !synced) return;
    const boards = snapshot.boards;
    if (boards.length === 0) {
      // A projection can arrive a moment after the room joins; wait for it
      // instead of minting a board the share may not write.
      if (!share && !readOnly) workspace.ensureBoard();
      return;
    }
    if (activeBoardId && boards.some((board) => board.id === activeBoardId)) return;

    // What the reader asked for, then the board they named as home, then the
    // first board: closing every tab lands somewhere they chose (ADR-0040, A24).
    const requested = resolveBoardId();
    const home = homeBoardId;
    const next =
      boards.find((board) => board.id === requested)?.id ??
      boards.find((board) => board.id === home)?.id ??
      boards[0]?.id ??
      null;
    if (next && next !== activeBoardId) setActiveBoardId(next);
  }, [
    ready,
    synced,
    snapshot.boards,
    activeBoardId,
    setActiveBoardId,
    workspace,
    readOnly,
    share,
    homeBoardId,
  ]);

  // Keep the URL shareable without a reload. A share keeps its token and never
  // gains a workspace id: the link is the whole credential.
  useEffect(() => {
    if (!activeBoardId) return;
    const url = new URL(window.location.href);
    if (share) {
      url.searchParams.set("share", share.token);
      url.searchParams.set("board", activeBoardId);
      // A share link carries no workspace id, even if it was pasted with one,
      // and never carries the owner fragment of the page it was created from.
      url.searchParams.delete("workspace");
      url.searchParams.delete("doc");
      url.searchParams.delete("fresh");
      url.hash = "";
    } else {
      url.searchParams.set("workspace", workspaceId);
      url.searchParams.set("board", activeBoardId);
      url.searchParams.delete("fresh");
    }
    window.history.replaceState(null, "", url);
  }, [activeBoardId, workspaceId, share]);

  useEffect(() => {
    // A share is a visit, not a workspace to come back to from the launcher.
    if (!activeBoardId || share) return;
    rememberWorkspace({
      id: workspaceId,
      title: snapshot.boards.find((board) => board.id === activeBoardId)?.name,
      boardId: activeBoardId,
    });
  }, [workspaceId, activeBoardId, snapshot.boards, share]);

  // A card link opens on that card. The projection may still be syncing, so wait
  // for the card to exist; once opened, closing the panel is the reader's choice.
  useEffect(() => {
    if (share?.scope !== "card" || shareCardOpened.current) return;
    if (!ready || !synced || !share.cardId) return;
    if (!snapshot.cards.some((card) => card.id === share.cardId)) return;
    shareCardOpened.current = true;
    openInspector(share.cardId);
  }, [share, ready, synced, snapshot.cards, openInspector]);

  useEffect(() => {
    setBoard(activeBoardId);
  }, [activeBoardId, setBoard]);

  // Carets are card- and field-scoped: peers only draw them in the editor the
  // author is actually typing in.
  useEffect(() => {
    setFocus(editingNodeId ? { nodeId: editingNodeId, field: editingField } : null);
  }, [editingNodeId, editingField, setFocus]);
}
