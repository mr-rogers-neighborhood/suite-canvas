import type { RefObject } from "react";
import type { RecentWorkspace } from "../session/workspaceTransfer";

export interface VaultImportDialogProps {
  vaultInputRef: (element: HTMLInputElement | null) => void;
  zipInputRef: RefObject<HTMLInputElement | null>;
  vaultTarget: (RecentWorkspace & { name: string }) | null;
  onClearTarget: () => void;
  onImportFolder: (target: RecentWorkspace & { name: string }, files: FileList | null) => void;
  onImportZip: (target: RecentWorkspace & { name: string }, files: FileList | null) => void;
}

/**
 * File picker inputs for Obsidian vault folder and zip imports.
 */
export function VaultImportDialog({
  vaultInputRef,
  zipInputRef,
  vaultTarget,
  onClearTarget,
  onImportFolder,
  onImportZip,
}: VaultImportDialogProps) {
  return (
    <>
      {/* A folder picker for the same import a drop performs, for a machine with
          no drag: `webkitdirectory` has no JSX spelling, so the ref sets it. */}
      <input
        ref={vaultInputRef}
        type="file"
        hidden
        multiple
        data-testid="launcher-vault-input"
        onChange={(event) => {
          const target = vaultTarget;
          const files = event.target.files;
          event.target.value = "";
          onClearTarget();
          if (target) onImportFolder(target, files);
        }}
      />
      {/* A tablet's Files app can hand over one file but cannot unpack a folder,
          so a zipped vault is the shape some devices offer. It is the same import
          past a reader, not a second importer. */}
      <input
        ref={zipInputRef}
        type="file"
        accept=".zip,application/zip"
        hidden
        data-testid="launcher-vault-zip-input"
        onChange={(event) => {
          const target = vaultTarget;
          const files = event.target.files;
          event.target.value = "";
          onClearTarget();
          if (target) onImportZip(target, files);
        }}
      />
    </>
  );
}
