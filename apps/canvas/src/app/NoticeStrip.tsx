import { useEffect, useState } from "react";
import { markNoticeRead, readNotices } from "../session/accountNotices";

/**
 * Says, once, that somebody looked.
 *
 * An impersonation is consent-based but the consent is old news by the time it is used, so
 * the account is told in the product rather than in a mail it may never read. The strip
 * shows the newest unread notice and one button; dismissing marks it read, and the next
 * unread one takes its place, so the ladder ends rather than repeats.
 *
 * Nothing renders for an account whose notices are all read, which is every account nobody
 * has looked at.
 */
export function NoticeStrip() {
  const [body, setBody] = useState<string | null>(null);
  const [id, setId] = useState<number | null>(null);
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    if (import.meta.env.VITE_SUITE_MODE === "standalone") return;
    let live = true;
    readNotices()
      .then(({ notices, unread: count }) => {
        if (!live) return;
        const next = notices.find((notice) => notice.readAt === null);
        setBody(next?.body ?? null);
        setId(next?.id ?? null);
        setUnread(count);
      })
      .catch(() => {
        if (live) setBody(null);
      });
    return () => {
      live = false;
    };
  }, []);

  if (body === null || id === null) return null;

  return (
    <div
      role="status"
      data-testid="notice-strip"
      className="flex items-start justify-center gap-2 border-b border-[var(--hairline)] bg-sky-50 px-3 py-1 text-[11px] text-sky-900 dark:bg-sky-500/15 dark:text-sky-200"
    >
      <span>{body}</span>
      <button
        type="button"
        data-testid="notice-strip-dismiss"
        className="underline underline-offset-2"
        onClick={() => {
          void markNoticeRead(id).catch(() => undefined);
          setId(null);
          setBody(null);
          setUnread((current) => Math.max(0, current - 1));
        }}
      >
        Dismiss
      </button>
      {unread > 1 ? <span className="opacity-70">({unread - 1} more)</span> : null}
    </div>
  );
}
