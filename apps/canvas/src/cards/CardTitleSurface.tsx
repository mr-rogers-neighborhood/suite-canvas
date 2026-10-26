import type { ContainerID, LoroDoc } from "loro-crdt";
import type { CursorEphemeralStore } from "loro-prosemirror";
import type { CSSProperties } from "react";
import type { PresenceUser } from "../collab/presence";
import { PeerNameTag } from "../presence/PeerNameTag";
import { CardTitleEditor } from "./CardBodyEditor";
import type { CardPanelEditingField } from "./CardPanel";

/** The title the embedded surface draws itself; the drawer has its own header. */
export function CardTitleSurface({
  title,
  cardDoc,
  titleId,
  cursorStore,
  localUser,
  editing,
  editContent,
  peer,
  onStartEditing,
  onFocus,
  onBlur,
  onCommit,
}: {
  title: string;
  cardDoc: LoroDoc;
  titleId: ContainerID | null;
  cursorStore: CursorEphemeralStore | null;
  localUser: PresenceUser | null;
  /** Which field this surface owns; null keeps the title read-only. */
  editing: CardPanelEditingField | null;
  editContent: boolean;
  /** The peer editing the title, when one is present. */
  peer: PresenceUser | null;
  onStartEditing: () => void;
  onFocus: () => void;
  onBlur: () => void;
  onCommit: () => void;
}) {
  const peerStyle: CSSProperties = peer
    ? { borderColor: peer.color, boxShadow: `0 0 0 2px ${peer.color}33` }
    : {};
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: the title overlay button starts editing; the editor owns keyboard input
    // biome-ignore lint/a11y/useKeyWithClickEvents: the title overlay button is the keyboard path
    <div
      className="card-panel-title relative mb-1 px-3 pt-3 pb-2"
      data-testid="card-panel-title"
      style={peerStyle}
      onClick={(event) => {
        if (!editContent || editing === "title") return;
        event.stopPropagation();
        onStartEditing();
      }}
    >
      {editing === "title" && titleId ? (
        <CardTitleEditor
          cardDoc={cardDoc}
          titleId={titleId}
          cursorStore={cursorStore}
          localUser={localUser}
          editable
          ariaLabel="Card panel title"
          onFocus={onFocus}
          onBlur={onBlur}
          onCommit={onCommit}
        />
      ) : (
        <>
          {editContent ? (
            <button
              type="button"
              aria-label="Edit card title"
              className="absolute inset-0 z-10 cursor-text"
              onClick={(event) => {
                event.stopPropagation();
                onStartEditing();
              }}
            />
          ) : null}
          <p className="truncate text-[13px] font-semibold text-[var(--ink)]">
            {title || "Untitled"}
          </p>
        </>
      )}
      {peer ? <PeerNameTag user={peer} className="card-peer-tag" /> : null}
    </div>
  );
}
