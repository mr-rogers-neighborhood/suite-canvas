import { StorageWarningBanner } from "../storage/StorageWarningBanner";
import { useUiStore } from "../store/useUiStore";
import "../styles/feedback.css";
import { ConnectionBanner } from "./ConnectionBanner";
import { SaveIndicator } from "./SaveIndicator";

/**
 * The top-centre rail inside the board: the relay first, then what this device
 * will do with its copy, then the saved state.
 *
 * One column rather than fixed corners, because the board's corners already
 * belong to other surfaces — the outline top-left, the inspector right, the dock
 * bottom-centre. The relay banner and the storage warning answer separate
 * questions and both stay mounted: neither shortens the other, so a tab can be
 * online and still be told its copy is at risk.
 */
export interface FeedbackRailProps {
  workspaceId: string;
  /** Whether an account stands behind this device; quietens the storage warning. */
  signedIn: boolean;
  /** Whether the relay holds the workspace right now, so a copy survives this browser. */
  synced: boolean;
}

export function FeedbackRail({ workspaceId, signedIn, synced }: FeedbackRailProps) {
  const inspectorOpen = useUiStore((store) => store.inspectorNodeId !== null);

  return (
    <div
      className="feedback-rail"
      data-testid="feedback-rail"
      data-inspector={inspectorOpen ? "open" : undefined}
    >
      <ConnectionBanner />
      <StorageWarningBanner
        workspaceId={workspaceId}
        signedIn={signedIn}
        synced={synced}
        className="storage-warning"
      />
      <SaveIndicator />
    </div>
  );
}
