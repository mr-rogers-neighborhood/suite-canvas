import type { WorkspaceDocument, WorkspaceTheme } from "@suite/graph";
import { useEffect, useRef, useState } from "react";

/**
 * The workspace's own palette, read from document meta. It is document data, so a
 * share sees the author's colours; it is meta rather than a snapshot section, so
 * the readers of it take their own subscription (the same reason the shell's paint
 * does — see `useWorkspacePaint` in `App`).
 */
export function useWorkspaceTheme(workspace: WorkspaceDocument): WorkspaceTheme | undefined {
  const [theme, setTheme] = useState(() => workspace.workspaceTheme());
  const signature = useRef(JSON.stringify(theme ?? null));
  useEffect(() => {
    const sync = () => {
      const next = workspace.workspaceTheme();
      const key = JSON.stringify(next ?? null);
      if (key === signature.current) return;
      signature.current = key;
      setTheme(next);
    };
    sync();
    return workspace.observeWorkspacePaint(sync);
  }, [workspace]);
  return theme;
}
