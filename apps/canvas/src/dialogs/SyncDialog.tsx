import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { syncPresentation } from "../feedback/syncState";
import { useEscapeLayer } from "../shell/escapeLayers";
import { useCanvasStore } from "../store/useCanvasStore";
import { useFocusTrap } from "./useFocusTrap";

/**
 * The one place a workspace is shared, joined, or let go of.
 *
 * A dialog because this is a rare errand — set up once, invite occasionally — and it leaves the
 * canvas edge-to-edge the rest of the time. What it does *not* hold is the state: waiting to be
 * let in lives in the title bar, because state that ends when a window closes is state that
 * lies. Every word here is a thing a person does; the protocol's vocabulary stays outside.
 */
export interface SyncDialogProps {
  open: boolean;
  onClose: () => void;
  /** Where the hub is, as a starting point. Prefilled with the local one. */
  defaultHost?: string;
}

const LOCAL_HOST = "ws://127.0.0.1:8787/sync";

export function SyncDialog({ open, onClose, defaultHost = LOCAL_HOST }: SyncDialogProps) {
  const panel = useRef<HTMLDivElement | null>(null);
  const sync = useCanvasStore((state) => state.sync);
  const enableSync = useCanvasStore((state) => state.enableSync);
  const disableSync = useCanvasStore((state) => state.disableSync);
  const inviteSomeone = useCanvasStore((state) => state.inviteSomeone);
  const joinWorkspace = useCanvasStore((state) => state.joinWorkspace);

  const [host, setHost] = useState(defaultHost);
  const [link, setLink] = useState<string | null>(null);
  const [pasted, setPasted] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  useEscapeLayer(onClose, open);
  useFocusTrap(panel, open);

  // A reopened dialog shows the invitation it made, because the person who closed it did not
  // necessarily hand it to anyone yet.
  useEffect(() => {
    if (!open) return;
    setProblem(null);
  }, [open]);

  if (!open) return null;

  const state = sync?.status ?? null;
  const presentation = syncPresentation({ state, people: sync?.members.length ?? 0 });
  const shared = state !== null && state.state !== "off";
  const waiting = state?.state === "waiting";

  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setProblem(null);
    try {
      await work();
    } catch (cause) {
      setProblem(cause instanceof Error ? cause.message : "That did not work.");
    } finally {
      setBusy(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-center justify-center">
      <button
        type="button"
        aria-label="Close"
        className="absolute inset-0 cursor-default border-0 bg-black/25 backdrop-blur-[2px]"
        onClick={onClose}
      />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label="Sync"
        tabIndex={-1}
        data-testid="sync-dialog"
        data-face={waiting ? "waiting" : shared ? "synced" : "local"}
        className="relative w-[min(420px,calc(100vw-2rem))] rounded-xl border border-[var(--hairline)] bg-[var(--surface)] p-4 shadow-xl outline-none"
      >
        <h2 className="text-sm font-semibold">Sync</h2>
        <p className="mt-1.5 text-xs leading-relaxed text-[var(--ink-muted)]">
          {presentation.sentence}
        </p>

        {waiting ? null : shared ? (
          <SyncedFace
            members={sync?.members ?? []}
            deviceId={sync?.deviceId ?? ""}
            link={link}
            busy={busy}
            onInvite={async () => {
              const made = await inviteSomeone("editor");
              setLink(made);
              if (made === null) setProblem("The invitation could not be written.");
            }}
            onStop={async () => {
              setLink(null);
              await disableSync();
            }}
            run={run}
          />
        ) : (
          <LocalFace
            host={host}
            pasted={pasted}
            busy={busy}
            onHost={setHost}
            onPasted={setPasted}
            onShare={() => run(() => enableSync(host))}
            onJoin={() => run(() => joinWorkspace(pasted))}
          />
        )}

        {problem === null ? null : (
          <p role="alert" data-testid="sync-problem" className="mt-3 text-xs text-red-600">
            {problem}
          </p>
        )}

        <div className="mt-4 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-3 py-1.5 text-xs text-[var(--ink-muted)] hover:bg-black/5 dark:hover:bg-white/10"
          >
            Done
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

interface LocalFaceProps {
  host: string;
  pasted: string;
  busy: boolean;
  onHost: (value: string) => void;
  onPasted: (value: string) => void;
  onShare: () => Promise<void>;
  onJoin: () => Promise<void>;
}

/** Not shared with anyone yet: the two errands, each a sentence and one control. */
function LocalFace({ host, pasted, busy, onHost, onPasted, onShare, onJoin }: LocalFaceProps) {
  return (
    <div className="mt-4 space-y-4">
      <section>
        <h3 className="text-xs font-semibold">Share this workspace</h3>
        <label className="mt-1 block text-[11px] text-[var(--ink-muted)]" htmlFor="sync-host">
          Where this machine is reachable. Start shows this machine&rsquo;s address.
        </label>
        <div className="mt-1.5 flex gap-2">
          <input
            id="sync-host"
            value={host}
            onChange={(event) => onHost(event.target.value)}
            spellCheck={false}
            className="min-w-0 flex-1 rounded-md border border-[var(--hairline)] bg-transparent px-2 py-1 text-xs"
          />
          <button
            type="button"
            disabled={busy}
            onClick={() => void onShare()}
            className="rounded-md px-3 py-1.5 text-xs font-medium hover:bg-black/5 disabled:opacity-50 dark:hover:bg-white/10"
          >
            Share
          </button>
        </div>
      </section>

      <section>
        <h3 className="text-xs font-semibold">Join one somebody shared</h3>
        <label className="mt-1 block text-[11px] text-[var(--ink-muted)]" htmlFor="sync-link">
          Paste the invitation they sent.
        </label>
        <div className="mt-1.5 flex gap-2">
          <input
            id="sync-link"
            value={pasted}
            onChange={(event) => onPasted(event.target.value)}
            spellCheck={false}
            placeholder="suite://join?…"
            className="min-w-0 flex-1 rounded-md border border-[var(--hairline)] bg-transparent px-2 py-1 text-xs"
          />
          <button
            type="button"
            disabled={busy || pasted.trim().length === 0}
            onClick={() => void onJoin()}
            className="rounded-md px-3 py-1.5 text-xs font-medium hover:bg-black/5 disabled:opacity-50 dark:hover:bg-white/10"
          >
            Join
          </button>
        </div>
      </section>
    </div>
  );
}

interface SyncedFaceProps {
  members: readonly { deviceId: string; name: string; role: string }[];
  deviceId: string;
  link: string | null;
  busy: boolean;
  onInvite: () => Promise<void>;
  onStop: () => Promise<void>;
  run: (work: () => Promise<void>) => Promise<void>;
}

const ROLE_WORDS: Record<string, string> = {
  owner: "in charge",
  editor: "can edit",
  viewer: "can read",
};

/** Shared: the invitation to give away, and who is already here. */
function SyncedFace({ members, deviceId, link, busy, onInvite, onStop, run }: SyncedFaceProps) {
  return (
    <div className="mt-4 space-y-4">
      <section>
        <h3 className="text-xs font-semibold">Invite someone</h3>
        <p className="mt-1 text-[11px] text-[var(--ink-muted)]">
          Send them this. They paste it into their own Canvas, and you let them in.
        </p>
        <div className="mt-1.5 flex gap-2">
          <output
            data-testid="sync-link"
            className="min-w-0 flex-1 select-all truncate rounded-md border border-[var(--hairline)] px-2 py-1 text-xs"
          >
            {link ?? "No invitation yet"}
          </output>
          <button
            type="button"
            disabled={busy}
            onClick={() => void run(onInvite)}
            className="rounded-md px-3 py-1.5 text-xs font-medium hover:bg-black/5 disabled:opacity-50 dark:hover:bg-white/10"
          >
            {link === null ? "Make one" : "Make another"}
          </button>
        </div>
      </section>

      <section>
        <h3 className="text-xs font-semibold">Devices here</h3>
        <ul data-testid="sync-members" className="mt-1 space-y-1">
          {members.length === 0 ? (
            <li className="text-[11px] text-[var(--ink-muted)]">Just this device so far.</li>
          ) : null}
          {members.map((member) => (
            <li key={member.deviceId} className="flex items-baseline justify-between gap-2 text-xs">
              <span className="truncate">
                {member.name}
                {member.deviceId === deviceId ? " (this device)" : ""}
              </span>
              <span className="shrink-0 text-[11px] text-[var(--ink-muted)]">
                {ROLE_WORDS[member.role] ?? member.role}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <button
        type="button"
        onClick={() => void run(onStop)}
        className="text-[11px] text-[var(--ink-muted)] underline-offset-2 hover:underline"
      >
        Stop sharing on this device
      </button>
    </div>
  );
}
