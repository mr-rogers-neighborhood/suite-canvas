import { type RefObject, useCallback, useEffect, useMemo } from "react";
import type { OpenedBook } from "../archive/epub/open";
import { usePresenceStore } from "../collab/usePresenceStore";
import { useUiStore } from "../store/useUiStore";
import type { PeerReader } from "./ReaderHead";

export interface UseCoReadingParams {
  attachmentId: string;
  sourceCardId?: string | undefined;
  chapterPath: string | null;
  chapterIndex: number;
  chapterCount: number;
  pendingOffset: number;
  book: OpenedBook | null;
  bodyRef: RefObject<HTMLDivElement | null>;
  setChapterPath: (path: string) => void;
  setPendingOffset: (offset: number) => void;
}

export interface UseCoReadingResult {
  coReaders: PeerReader[];
  followPeerId: string | null;
  handleToggleFollow: (clientId: string) => void;
  clearFollow: () => void;
  publishReadingPosition: (chapterPath: string, offset: number, progress: number) => void;
}

export function useCoReading({
  attachmentId,
  sourceCardId,
  chapterPath,
  chapterIndex,
  chapterCount,
  pendingOffset,
  book,
  bodyRef,
  setChapterPath,
  setPendingOffset,
}: UseCoReadingParams): UseCoReadingResult {
  const allPeers = usePresenceStore((state) => state.peers);
  const setBookReading = usePresenceStore((state) => state.setBookReading);
  const followPeerId = useUiStore((state) => state.followPeerId);
  const setFollowPeerId = useUiStore((state) => state.setFollowPeerId);

  const coReaders = useMemo<PeerReader[]>(() => {
    return Object.values(allPeers).flatMap((peer) => {
      const reading = peer.bookReading;
      if (!reading) return [];
      const matchesAttachment = reading.attachmentId === attachmentId;
      const matchesCard = sourceCardId !== undefined && reading.cardId === sourceCardId;
      if (!matchesAttachment && !matchesCard) return [];
      return [
        {
          clientId: peer.clientId,
          user: peer.user,
          chapterPath: reading.chapterPath,
          progress: reading.progress,
          offset: reading.offset,
        },
      ];
    });
  }, [allPeers, attachmentId, sourceCardId]);

  const handleToggleFollow = useCallback(
    (clientId: string) => {
      setFollowPeerId(followPeerId === clientId ? null : clientId);
    },
    [followPeerId, setFollowPeerId],
  );

  const clearFollow = useCallback(() => {
    if (followPeerId !== null) setFollowPeerId(null);
  }, [followPeerId, setFollowPeerId]);

  const publishReadingPosition = useCallback(
    (path: string, offset: number, progress: number) => {
      setBookReading({
        cardId: sourceCardId ?? "",
        attachmentId,
        chapterPath: path,
        progress,
        offset,
      });
    },
    [attachmentId, setBookReading, sourceCardId],
  );

  /** Follow mode: follow the active peer through chapters and scroll position. */
  useEffect(() => {
    if (followPeerId === null) return;
    const target = coReaders.find((p) => p.clientId === followPeerId);
    if (!target) return;
    if (
      target.chapterPath &&
      target.chapterPath !== chapterPath &&
      book?.chapters.includes(target.chapterPath)
    ) {
      setChapterPath(target.chapterPath);
      setPendingOffset(target.offset ?? 0);
    } else if (
      typeof target.offset === "number" &&
      bodyRef.current &&
      Math.abs(bodyRef.current.scrollTop - target.offset) > 10
    ) {
      bodyRef.current.scrollTop = target.offset;
    }
  }, [followPeerId, coReaders, chapterPath, book, bodyRef, setChapterPath, setPendingOffset]);

  /** Broadcast local reader presence so peers can see our reading progress. */
  useEffect(() => {
    if (chapterPath === null || attachmentId.length === 0) return;
    setBookReading({
      cardId: sourceCardId ?? "",
      attachmentId,
      chapterPath,
      progress: chapterCount === 0 ? 0 : Math.min(1, chapterIndex / chapterCount),
      offset: pendingOffset,
    });
    return () => {
      setBookReading(null);
    };
  }, [
    chapterPath,
    attachmentId,
    sourceCardId,
    chapterIndex,
    chapterCount,
    pendingOffset,
    setBookReading,
  ]);

  return {
    coReaders,
    followPeerId,
    handleToggleFollow,
    clearFollow,
    publishReadingPosition,
  };
}
