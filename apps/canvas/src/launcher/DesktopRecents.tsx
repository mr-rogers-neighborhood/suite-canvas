import { useEffect, useState } from "react";
import { type BridgeRecentFile, desktopBridge } from "../host/bridge";

/**
 * The files this machine opened, shown on the desktop launcher.
 *
 * The list comes from the main process, which is the only thing that knows a file
 * was opened. A workspace-only list would be wrong here: on the desktop a
 * "workspace" is a file, and the recents the web launcher keeps are IndexedDB
 * entries that do not exist in this profile.
 *
 * The folder is shown on every row because the point of a file-first app is that
 * the file is somewhere a person can find.
 */
export function DesktopRecents(): React.JSX.Element | null {
  const [files, setFiles] = useState<readonly BridgeRecentFile[]>([]);
  const [missing, setMissing] = useState<string | null>(null);

  useEffect(() => {
    const bridge = desktopBridge();
    if (bridge === null) return;
    let live = true;
    void bridge.recentFiles().then((entries) => {
      if (live) setFiles(entries);
    });
    return () => {
      live = false;
    };
  }, []);

  if (files.length === 0) {
    return (
      <p
        data-testid="desktop-recents-empty"
        className="mt-3 rounded-xl border border-dashed border-[var(--hairline)] px-4 py-8 text-center text-[13px] text-[var(--ink-muted)]"
      >
        Nothing opened yet. Start a new workspace or open a <code>.canvas</code> file.
      </p>
    );
  }

  return (
    <div data-testid="desktop-recents">
      <ul className="mt-2 divide-y divide-[var(--hairline)] overflow-hidden rounded-xl border border-[var(--hairline)]">
        {files.map((file) => (
          <li key={file.path} className="flex items-center gap-2">
            <button
              type="button"
              data-testid="desktop-recent"
              className="flex min-w-0 flex-1 flex-col items-start gap-0.5 px-3 py-2 text-left transition-colors hover:bg-black/5 dark:hover:bg-white/10"
              onClick={() => {
                const bridge = desktopBridge();
                if (bridge === null) return;
                setMissing(null);
                void bridge.openDocument(file.path).catch(() => {
                  setMissing(file.path);
                });
              }}
            >
              <span className="truncate text-[13px] font-medium">{file.name}</span>
              <span className="truncate text-[11px] text-[var(--ink-muted)]">{file.folder}</span>
            </button>
            <button
              type="button"
              aria-label={`Forget ${file.name}`}
              className="mr-2 rounded px-2 py-1 text-[11px] text-[var(--ink-muted)] hover:text-[var(--ink)]"
              onClick={() => {
                const bridge = desktopBridge();
                if (bridge === null) return;
                void bridge.forgetRecent(file.path);
                setFiles((current) => current.filter((entry) => entry.path !== file.path));
              }}
            >
              Forget
            </button>
          </li>
        ))}
      </ul>
      {missing === null ? null : (
        <p className="mt-2 text-[11px] text-[var(--ink-muted)]">
          That file is no longer open in this window. Open it again from its folder.
        </p>
      )}
    </div>
  );
}
