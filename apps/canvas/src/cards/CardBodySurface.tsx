import type { ContainerID, LoroDoc } from "loro-crdt";
import type { CursorEphemeralStore } from "loro-prosemirror";
import type { CSSProperties } from "react";
import type { PresenceUser } from "../collab/presence";
import { PeerNameTag } from "../presence/PeerNameTag";
import { CardBodyEditor } from "./CardBodyEditor";
import type { CardPanelEditingField } from "./CardPanel";

/** The body of a card: read-only text, or the editor when this surface owns it. */
export function CardBodySurface({
  cardId,
  cardDoc,
  contentId,
  cursorStore,
  localUser,
  editing,
  editContent,
  peer,
  onStartEditing,
  onFocus,
  onBlur,
  onOpenCardPanel,
}: {
  cardId: string;
  cardDoc: LoroDoc;
  contentId: ContainerID | null;
  cursorStore: CursorEphemeralStore | null;
  localUser: PresenceUser | null;
  /** Which field this surface owns; null keeps the body read-only. */
  editing: CardPanelEditingField | null;
  editContent: boolean;
  /** The peer editing this body, when one is present. */
  peer: PresenceUser | null;
  onStartEditing: () => void;
  onFocus: () => void;
  onBlur: () => void;
  onOpenCardPanel: (cardId: string) => void;
}) {
  const peerStyle: CSSProperties = peer
    ? { borderColor: peer.color, boxShadow: `0 0 0 2px ${peer.color}33` }
    : {};
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: a click on the read-only body moves the editable surface here
    // biome-ignore lint/a11y/useKeyWithClickEvents: the panel title and Edit button are the keyboard path
    <div
      className={`card-panel-body ${editing === "body" ? "is-editing" : "cursor-text"}`}
      data-testid="card-panel-body"
      data-editing={editing === "body" ? "true" : undefined}
      style={peerStyle}
      onClick={(event) => {
        if (!editContent || editing === "body") return;
        event.stopPropagation();
        onStartEditing();
      }}
    >
      {peer ? <PeerNameTag user={peer} className="card-peer-tag" /> : null}
      {contentId === null ? (
        <p className="text-[13px] text-[var(--ink-muted)]" data-testid="card-panel-empty-body">
          No content yet.
        </p>
      ) : (
        <CardBodyEditor
          cardId={cardId}
          cardDoc={cardDoc}
          contentId={contentId}
          // Only the surface that owns the body publishes carets; a read-only
          // twin must not clear the shared local cursor on its own updates.
          cursorStore={editing === "body" ? cursorStore : null}
          localUser={localUser}
          editable={editContent && editing === "body"}
          readOnly={!editContent}
          ariaLabel="Note body"
          onFocus={onFocus}
          onBlur={onBlur}
          onOpenCardPanel={onOpenCardPanel}
        />
      )}
    </div>
  );
}
