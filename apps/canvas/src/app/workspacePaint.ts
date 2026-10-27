import type { PaletteSwatch, WorkspaceDocument } from "@suite/graph";
import { type RefObject, useCallback, useEffect, useRef, useState } from "react";
import { readPalette, type SurfacePalette } from "../canvas/rules";
import type { ShareSession } from "../session/session";

/** What the app bar calls this document. A share never names its owner's workspace. */
export function documentLabel(share: ShareSession, workspaceId: string): string {
  if (share.scope === "board") return "Board share";
  if (share.scope === "card") return "Card share";
  if (share.scope === "selection") return "Selection share";
  return workspaceId;
}

/**
 * Where the workspace says its navigation goes: the board that opens when
 * nothing is open, and the board a new tab opens. Both are workspace meta, which
 * is not a snapshot section, so this reads them the same way the paint hook does
 * and only when they actually change.
 */
export function useWorkspaceNavigation(workspace: WorkspaceDocument): {
  homeBoardId: string | null;
  newTabBoardId: string | null;
} {
  const read = useCallback(
    () => ({
      homeBoardId: workspace.workspaceHomeBoardId(),
      newTabBoardId: workspace.newTabBoardId(),
    }),
    [workspace],
  );
  const [navigation, setNavigation] = useState(read);
  const signature = useRef(JSON.stringify(navigation));
  useEffect(() => {
    const sync = () => {
      const next = read();
      const key = JSON.stringify(next);
      if (key === signature.current) return;
      signature.current = key;
      setNavigation(next);
    };
    sync();
    return workspace.observeWorkspaceMeta(sync);
  }, [read, workspace]);
  return navigation;
}

/**
 * The live role palette, read from the token layer on the shell root rather
 * than kept as a second copy (ADR-0046 §1). A theme change is exactly when it
 * moves.
 */
export function useSurfacePalette(
  root: RefObject<HTMLElement | null>,
  themeMode: string,
): SurfacePalette {
  const [palette, setPalette] = useState<SurfacePalette>({});
  // biome-ignore lint/correctness/useExhaustiveDependencies: the theme mode is the trigger, not an input; the palette is read back from the DOM once the theme's classes have moved.
  useEffect(() => {
    const node = root.current;
    if (node) setPalette(readPalette(node));
  }, [root, themeMode]);
  return palette;
}

/**
 * The workspace palette. Meta, like the navigation, so it takes its own
 * subscription; a swatch edit must reach every card without repainting the shell
 * for an unrelated write.
 */
export function useWorkspacePalette(workspace: WorkspaceDocument): PaletteSwatch[] {
  const read = useCallback(() => workspace.palette(), [workspace]);
  const [palette, setPalette] = useState(read);
  const signature = useRef(JSON.stringify(palette));
  useEffect(() => {
    const sync = () => {
      const next = read();
      const key = JSON.stringify(next);
      if (key === signature.current) return;
      signature.current = key;
      setPalette(next);
    };
    sync();
    return workspace.observeWorkspaceMeta(sync);
  }, [read, workspace]);
  return palette;
}
