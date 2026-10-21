import type { Rect, Section, SectionColor } from "@suite/graph";
import { useReactFlow, useViewport, ViewportPortal } from "@xyflow/react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { PeerPresence } from "../collab/presence";
import { PeerNameTag } from "../components/PeerNameTag";
import type { SectionOffset } from "./sectionLayout";

type ResizeDirection = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";

const RESIZE_DIRECTIONS: ResizeDirection[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

const MIN_WIDTH = 160;
const MIN_HEIGHT = 100;

const FILL: Record<SectionColor, string> = {
  slate: "color-mix(in srgb, var(--section-slate) 9%, transparent)",
  blue: "color-mix(in srgb, var(--section-blue) 10%, transparent)",
  green: "color-mix(in srgb, var(--section-green) 10%, transparent)",
  amber: "color-mix(in srgb, var(--section-amber) 11%, transparent)",
  rose: "color-mix(in srgb, var(--section-rose) 10%, transparent)",
  violet: "color-mix(in srgb, var(--section-violet) 10%, transparent)",
};

const STROKE: Record<SectionColor, string> = {
  slate: "var(--section-slate)",
  blue: "var(--section-blue)",
  green: "var(--section-green)",
  amber: "var(--section-amber)",
  rose: "var(--section-rose)",
  violet: "var(--section-violet)",
};

export interface SectionLayerProps {
  sections: Section[];
  membership: Map<string, string>;
  offsets: Map<string, SectionOffset>;
  resizes: Map<string, Rect>;
  peers: PeerPresence[];
  selectedSectionId: string | null;
  editingSectionId: string | null;
  onSelect: (id: string) => void;
  onStartRename: (id: string) => void;
  onCommitRename: (id: string, title: string) => void;
  onCancelRename: () => void;
  onDrag: (id: string, position: { x: number; y: number }) => void;
  onDragEnd: (id: string, position: { x: number; y: number }) => void;
  onResize: (id: string, rect: Rect) => void;
  onResizeEnd: (id: string, rect: Rect) => void;
  onContextMenu: (event: React.MouseEvent, id: string) => void;
}

export function SectionLayer({
  sections,
  membership,
  offsets,
  resizes,
  peers,
  selectedSectionId,
  editingSectionId,
  onSelect,
  onStartRename,
  onCommitRename,
  onCancelRename,
  onDrag,
  onDragEnd,
  onResize,
  onResizeEnd,
  onContextMenu,
}: SectionLayerProps) {
  const { screenToFlowPosition } = useReactFlow();
  const { zoom } = useViewport();
  const inverseZoom = 1 / (zoom || 1);
  const cleanup = useRef<(() => void) | null>(null);
  const titleInput = useRef<HTMLInputElement | null>(null);
  const [draft, setDraft] = useState("");

  const members = useMemo(() => {
    const counts = new Map<string, number>();
    for (const sectionId of membership.values()) {
      counts.set(sectionId, (counts.get(sectionId) ?? 0) + 1);
    }
    return counts;
  }, [membership]);

  const peerGesture = useMemo(() => {
    const map = new Map<string, PeerPresence>();
    for (const peer of peers) {
      const sectionId = peer.sectionDrag?.sectionId ?? peer.sectionResize?.sectionId;
      if (sectionId && !map.has(sectionId)) map.set(sectionId, peer);
    }
    return map;
  }, [peers]);

  const peerSelection = useMemo(() => {
    const map = new Map<string, string>();
    for (const peer of peers) {
      const sectionId = peer.selection?.sectionId;
      if (sectionId && !map.has(sectionId)) map.set(sectionId, peer.user.color);
    }
    return map;
  }, [peers]);

  useEffect(() => {
    if (!editingSectionId) return;
    const section = sections.find((entry) => entry.id === editingSectionId);
    setDraft(section?.title ?? "");
  }, [editingSectionId, sections]);

  useEffect(() => {
    if (!editingSectionId) return;
    titleInput.current?.focus();
    titleInput.current?.select();
  }, [editingSectionId]);

  useEffect(
    () => () => {
      cleanup.current?.();
    },
    [],
  );

  const rectFor = (section: Section): Rect => {
    const resizing = resizes.get(section.id);
    if (resizing) return resizing;
    const offset = offsets.get(section.id);
    return {
      x: section.x + (offset?.dx ?? 0),
      y: section.y + (offset?.dy ?? 0),
      width: section.width,
      height: section.height,
    };
  };

  const startWindowGesture = (
    move: (event: PointerEvent) => void,
    end: (event: PointerEvent) => void,
  ) => {
    cleanup.current?.();
    const onMove = (event: PointerEvent) => move(event);
    const onUp = (event: PointerEvent) => {
      window.removeEventListener("pointermove", onMove, true);
      window.removeEventListener("pointerup", onUp, true);
      window.removeEventListener("pointercancel", onUp, true);
      cleanup.current = null;
      end(event);
    };
    // Capture phase: canvas panning/selection handlers must not swallow the
    // release before the gesture can commit.
    window.addEventListener("pointermove", onMove, true);
    window.addEventListener("pointerup", onUp, true);
    window.addEventListener("pointercancel", onUp, true);
    cleanup.current = () => {
      window.removeEventListener("pointermove", onMove, true);
      window.removeEventListener("pointerup", onUp, true);
      window.removeEventListener("pointercancel", onUp, true);
    };
  };

  const startDrag = (event: React.PointerEvent, section: Section) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    onSelect(section.id);
    if (editingSectionId === section.id) return;

    const start = screenToFlowPosition({ x: event.clientX, y: event.clientY });
    const origin = { x: section.x, y: section.y };
    const positionAt = (pointer: PointerEvent) => {
      const current = screenToFlowPosition({ x: pointer.clientX, y: pointer.clientY });
      return {
        x: origin.x + current.x - start.x,
        y: origin.y + current.y - start.y,
      };
    };

    startWindowGesture(
      (pointer) => onDrag(section.id, positionAt(pointer)),
      (pointer) => onDragEnd(section.id, positionAt(pointer)),
    );
  };

  const startResize = (event: React.PointerEvent, section: Section, direction: ResizeDirection) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    onSelect(section.id);

    const start = screenToFlowPosition({ x: event.clientX, y: event.clientY });
    const base = rectFor(section);
    const rectAt = (pointer: PointerEvent): Rect => {
      const current = screenToFlowPosition({ x: pointer.clientX, y: pointer.clientY });
      const dx = current.x - start.x;
      const dy = current.y - start.y;
      let { x, y, width, height } = base;

      if (direction.includes("e")) width = Math.max(MIN_WIDTH, base.width + dx);
      if (direction.includes("s")) height = Math.max(MIN_HEIGHT, base.height + dy);
      if (direction.includes("w")) {
        width = Math.max(MIN_WIDTH, base.width - dx);
        x = base.x + base.width - width;
      }
      if (direction.includes("n")) {
        height = Math.max(MIN_HEIGHT, base.height - dy);
        y = base.y + base.height - height;
      }
      return { x, y, width, height };
    };

    startWindowGesture(
      (pointer) => onResize(section.id, rectAt(pointer)),
      (pointer) => onResizeEnd(section.id, rectAt(pointer)),
    );
  };

  const commitTitle = (section: Section) => {
    onCommitRename(section.id, draft);
  };

  return (
    <>
      <ViewportPortal>
        <div className="section-background-layer" data-testid="section-background-layer">
          {sections.map((section) => {
            const rect = rectFor(section);
            const color = section.color ?? "slate";
            const selected = selectedSectionId === section.id;
            const peerColor = peerSelection.get(section.id);
            return (
              <button
                key={section.id}
                type="button"
                aria-label={`Section: ${section.title || "Untitled section"}`}
                data-testid={`section-region-${section.id}`}
                className={`section-region${selected ? " is-selected" : ""}`}
                style={{
                  left: rect.x,
                  top: rect.y,
                  width: rect.width,
                  height: rect.height,
                  background: FILL[color],
                  borderColor: selected ? STROKE[color] : undefined,
                  ...(peerColor ? { boxShadow: `0 0 0 2px ${peerColor}66` } : {}),
                  ...(peerGesture.has(section.id)
                    ? {
                        transition:
                          "left 60ms linear, top 60ms linear, width 60ms linear, height 60ms linear",
                      }
                    : {}),
                }}
                onPointerDown={(event) => {
                  event.stopPropagation();
                  onSelect(section.id);
                }}
                onContextMenu={(event) => onContextMenu(event, section.id)}
              />
            );
          })}
        </div>
      </ViewportPortal>

      <ViewportPortal>
        <div className="section-header-layer" data-testid="section-header-layer">
          {sections.map((section) => {
            const rect = rectFor(section);
            const color = section.color ?? "slate";
            const selected = selectedSectionId === section.id;
            const peer = peerGesture.get(section.id);
            const count = members.get(section.id) ?? 0;
            return (
              // biome-ignore lint/a11y/noStaticElementInteractions: the header is the section's drag handle; its title and rename field are separate controls.
              <div
                key={section.id}
                data-testid={`section-header-${section.id}`}
                className="section-header"
                style={{
                  left: rect.x + 8,
                  top: rect.y + 6,
                  transform: `scale(${inverseZoom})`,
                  borderColor: selected ? STROKE[color] : undefined,
                  ...(peer ? { transition: "left 60ms linear, top 60ms linear" } : {}),
                }}
                onPointerDown={(event) => startDrag(event, section)}
                onContextMenu={(event) => onContextMenu(event, section.id)}
              >
                <span
                  aria-hidden="true"
                  className="section-color-dot"
                  style={{ backgroundColor: STROKE[color] }}
                />
                {editingSectionId === section.id ? (
                  <input
                    ref={editingSectionId === section.id ? titleInput : undefined}
                    value={draft}
                    aria-label="Section title"
                    data-testid="section-title-input"
                    className="section-title-input nodrag"
                    onPointerDown={(event) => event.stopPropagation()}
                    onChange={(event) => setDraft(event.target.value)}
                    onBlur={() => commitTitle(section)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        event.stopPropagation();
                        commitTitle(section);
                      } else if (event.key === "Escape") {
                        event.preventDefault();
                        event.stopPropagation();
                        setDraft(section.title);
                        onCancelRename();
                      }
                    }}
                  />
                ) : (
                  <button
                    type="button"
                    className="section-title"
                    aria-label={`Section: ${section.title || "Untitled section"}`}
                    onDoubleClick={(event) => {
                      event.stopPropagation();
                      onStartRename(section.id);
                    }}
                  >
                    {section.title || "Untitled section"}
                  </button>
                )}
                <span className="section-count">{count}</span>
                {peer ? <PeerNameTag user={peer.user} /> : null}
              </div>
            );
          })}

          {sections
            .filter((section) => section.id === selectedSectionId)
            .flatMap((section) => {
              const rect = rectFor(section);
              return RESIZE_DIRECTIONS.map((direction) => {
                const style = resizeHandleStyle(direction, rect, inverseZoom);
                return (
                  <span
                    key={`${section.id}:${direction}`}
                    data-testid={`section-handle-${direction}`}
                    data-direction={direction}
                    className="section-resize-handle"
                    style={style}
                    onPointerDown={(event) => startResize(event, section, direction)}
                  />
                );
              });
            })}
        </div>
      </ViewportPortal>
    </>
  );
}

function resizeHandleStyle(direction: ResizeDirection, rect: Rect, inverseZoom: number) {
  const size = 9 * inverseZoom;
  const half = size / 2;
  const style: React.CSSProperties = {
    width: size,
    height: size,
    borderRadius: 2 * inverseZoom,
  };
  if (direction.includes("n")) style.top = rect.y - half;
  if (direction.includes("s")) style.top = rect.y + rect.height - half;
  if (!direction.includes("n") && !direction.includes("s")) {
    style.top = rect.y + rect.height / 2 - half;
  }
  if (direction.includes("w")) style.left = rect.x - half;
  if (direction.includes("e")) style.left = rect.x + rect.width - half;
  if (!direction.includes("w") && !direction.includes("e")) {
    style.left = rect.x + rect.width / 2 - half;
  }
  return style;
}
