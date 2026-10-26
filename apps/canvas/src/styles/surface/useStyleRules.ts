import type { StyleRule, WorkspaceDocument } from "@suite/graph";
import { useCallback, useEffect, useRef, useState } from "react";
import { useCanvasStore } from "../../store/useCanvasStore";

/**
 * The workspace's named style rules, subscribed.
 *
 * Rules live in the document meta rather than in a snapshot section, so the snapshot would never mention
 * them: they have their own notification. One hook means the shell painter, the style editor and the
 * rule list cannot disagree about what the ladder currently says.
 */
export function useStyleRules(injected: WorkspaceDocument | null = null): StyleRule[] {
  const storeWorkspace = useCanvasStore((state) => state.workspace);
  const workspace = injected ?? storeWorkspace;
  const read = useCallback(() => workspace.styleRules(), [workspace]);
  const [rules, setRules] = useState<StyleRule[]>(read);
  const signature = useRef(JSON.stringify(rules));

  useEffect(() => {
    const sync = () => {
      const next = read();
      const key = JSON.stringify(next);
      if (key === signature.current) return;
      signature.current = key;
      setRules(next);
    };
    sync();
    return workspace.observeWorkspacePaint(sync);
  }, [read, workspace]);

  return rules;
}
