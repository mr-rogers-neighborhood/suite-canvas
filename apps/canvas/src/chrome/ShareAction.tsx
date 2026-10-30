import { useEffect, useState } from "react";
import { useAccountStore } from "../auth/useAccountStore";
import { useCardTitle } from "../hooks/useCardContainers";
import { isShareSession } from "../session/session";
import type { ShareScope } from "../session/shares";
import { ShareDialog } from "../sharing/ShareDialog";
import { useUiStore } from "../store/useUiStore";

/**
 * Share, as its own control in the app bar.
 *
 * It lived inside the workspace menu, which put the one action a reader reaches for while
 * looking at a board behind a second click and a list of imports and exports. Sharing is a
 * verb about the thing on screen, so it sits beside the sync pill — the control that already
 * says who else is here — and the menu goes back to being about the workspace as a document.
 *
 * Sharing needs the relay. The `import.meta.env.VITE_SUITE_MODE` literal is tested directly
 * so a standalone build drops this component, its dialog and the relay client behind them
 * rather than shipping UI that cannot work.
 */
export interface ShareActionProps {
  workspaceId: string;
  boardId: string | null;
  title: string;
}

export function ShareAction({ workspaceId, boardId, title }: ShareActionProps) {
  const canManageLinks = useUiStore((state) => state.canManageLinks);
  const shareRequest = useUiStore((state) => state.shareRequest);
  const clearShareRequest = useUiStore((state) => state.clearShareRequest);
  const inspectorNodeId = useUiStore((state) => state.inspectorNodeId);
  const selectedNodeIds = useUiStore((state) => state.selectedNodeIds);
  const [open, setOpen] = useState(false);
  const [scope, setScope] = useState<ShareScope>("workspace");

  // A canvas gesture asks for the dialog without lifting selection state.
  useEffect(() => {
    if (!shareRequest) return;
    setScope(shareRequest);
    setOpen(true);
    clearShareRequest();
  }, [shareRequest, clearShareRequest]);

  // The dialog shares one card: the inspected one, or a lone selection.
  const soleSelection = selectedNodeIds.length === 1 ? (selectedNodeIds[0] ?? null) : null;
  const selectedCardId = inspectorNodeId ?? soleSelection;
  const selectedCardIds = [...new Set(selectedNodeIds)];
  const selectedCardTitle = useCardTitle(selectedCardId ?? "");

  // A share session has no workspace-level chrome, and a standalone build has no relay.
  if (import.meta.env.VITE_SUITE_MODE === "standalone" || isShareSession()) {
    return null;
  }

  const handleShareClick = () => {
    if (!canManageLinks) {
      useAccountStore.getState().openSignIn("sign-up");
      return;
    }
    setScope("workspace");
    setOpen(true);
  };

  return (
    <>
      <button
        type="button"
        data-testid="share-action"
        title={
          canManageLinks
            ? "Share this workspace, a board or a card."
            : "Sign in or create a free account to share this workspace."
        }
        className="inline-flex h-6 items-center rounded-md px-2 text-[11px] leading-none text-[var(--ink-muted)] transition-colors hover:bg-black/5 hover:text-[var(--ink)] dark:hover:bg-white/10"
        onClick={handleShareClick}
      >
        Share
      </button>
      {open ? (
        <ShareDialog
          workspaceId={workspaceId}
          boardId={boardId}
          boardName={boardId ? title : null}
          cardId={selectedCardId}
          cardTitle={selectedCardId ? selectedCardTitle : null}
          selectedCardIds={selectedCardIds}
          initialScope={scope}
          onClose={() => {
            setOpen(false);
            setScope("workspace");
          }}
        />
      ) : null}
    </>
  );
}
