import { useState } from "react";
import type { SyncMember } from "../store/useCanvasStore";

/**
 * The four things the sync dialog can be asking.
 *
 * Each is a question with an answer a person can give in one gesture: share or join, hand over
 * an invitation, keep a way back in, or type the word that opens one. None of them shows a
 * frame, an epoch or a key, because those are how it works and not what anybody is deciding.
 */

export interface LocalFaceProps {
  host: string;
  hubRunning: boolean;
  pasted: string;
  busy: boolean;
  onHost: (value: string) => void;
  onPasted: (value: string) => void;
  onShare: () => Promise<void>;
  onJoin: () => Promise<void>;
  onRestore: () => Promise<void>;
}

/** Not shared with anyone yet: the two errands, and the door for a device that has a file. */
export function LocalFace({
  host,
  hubRunning,
  pasted,
  busy,
  onHost,
  onPasted,
  onShare,
  onJoin,
  onRestore,
}: LocalFaceProps) {
  return (
    <div className="mt-4 space-y-4">
      <section>
        <h3 className="text-xs font-semibold">Share this workspace</h3>
        <label className="mt-1 block text-[11px] text-[var(--ink-muted)]" htmlFor="sync-host">
          {hubRunning
            ? "This machine is listening here."
            : "Start shows this machine's address. It is not running right now."}
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

      <button
        type="button"
        disabled={busy}
        onClick={() => void onRestore()}
        className="text-[11px] text-[var(--ink-muted)] underline-offset-2 hover:underline"
      >
        I have a recovery file for this workspace
      </button>
    </div>
  );
}

export interface SyncedFaceProps {
  members: readonly SyncMember[];
  deviceId: string;
  link: string | null;
  busy: boolean;
  /** Whether to offer a way back in: true only while nobody has answered the question. */
  offerKit: boolean;
  /** The device being removed, so its row can say so. */
  removing: string | null;
  onSaveKit: () => void;
  onInvite: () => Promise<void>;
  onRemove: (deviceId: string) => Promise<void>;
  onStop: () => Promise<void>;
  run: (work: () => Promise<void>) => Promise<void>;
}

const ROLE_WORDS: Record<string, string> = {
  owner: "in charge",
  editor: "can edit",
  viewer: "can read",
};

/** Shared: the invitation to give away, who is here, and one way to leave. */
export function SyncedFace({
  members,
  deviceId,
  link,
  busy,
  offerKit,
  removing,
  onSaveKit,
  onInvite,
  onRemove,
  onStop,
  run,
}: SyncedFaceProps) {
  return (
    <div className="mt-4 space-y-4">
      <section>
        <h3 className="text-xs font-semibold">Invite someone</h3>
        <p className="mt-1 text-[11px] text-[var(--ink-muted)]">
          Send them this. They paste it into their own Canvas, and it lets them in.
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
              <span className="flex shrink-0 items-baseline gap-2">
                <span className="text-[11px] text-[var(--ink-muted)]">
                  {ROLE_WORDS[member.role] ?? member.role}
                </span>
                {member.deviceId !== deviceId ? (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void run(() => onRemove(member.deviceId))}
                    className="text-[11px] text-[var(--ink-muted)] underline-offset-2 hover:underline disabled:opacity-50"
                  >
                    {removing === member.deviceId ? "Removing…" : "Remove"}
                  </button>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      </section>

      {offerKit ? (
        <section className="rounded-md border border-[var(--hairline)] p-2">
          <h3 className="text-xs font-semibold">Keep a way back in</h3>
          <p className="mt-1 text-[11px] text-[var(--ink-muted)]">
            This machine cannot restore the workspace, and neither can any other. A file saved now
            can.
          </p>
          <button
            type="button"
            disabled={busy}
            onClick={onSaveKit}
            className="mt-1.5 rounded-md px-3 py-1.5 text-xs font-medium hover:bg-black/5 disabled:opacity-50 dark:hover:bg-white/10"
          >
            Save it
          </button>
        </section>
      ) : null}

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

export interface KitStepProps {
  busy: boolean;
  onSave: (passphrase: string | null) => Promise<void>;
  onDecline: () => Promise<void>;
}

/** The offer, with the one choice that changes the file. */
export function KitStep({ busy, onSave, onDecline }: KitStepProps) {
  const [passphrase, setPassphrase] = useState("");
  const secret = passphrase.trim().length > 0 ? passphrase : null;

  return (
    <div className="mt-4 space-y-3">
      <label className="block text-[11px] text-[var(--ink-muted)]" htmlFor="sync-kit-passphrase">
        Add a passphrase (optional). Without one, anyone who opens the file becomes this device.
      </label>
      <input
        id="sync-kit-passphrase"
        type="password"
        value={passphrase}
        onChange={(event) => setPassphrase(event.target.value)}
        className="w-full rounded-md border border-[var(--hairline)] bg-transparent px-2 py-1 text-xs"
      />
      <div className="flex justify-end gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => void onDecline()}
          className="rounded-md px-3 py-1.5 text-xs text-[var(--ink-muted)] hover:bg-black/5 disabled:opacity-50 dark:hover:bg-white/10"
        >
          Not now
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void onSave(secret)}
          className="rounded-md bg-[var(--ink)] px-3 py-1.5 text-xs font-medium text-[var(--surface)] disabled:opacity-50"
        >
          Save the file
        </button>
      </div>
    </div>
  );
}

export interface UnlockStepProps {
  busy: boolean;
  onOpen: (passphrase: string) => Promise<void>;
}

/** The word that opens a sealed file. */
export function UnlockStep({ busy, onOpen }: UnlockStepProps) {
  const [passphrase, setPassphrase] = useState("");

  return (
    <div className="mt-4 space-y-3">
      <label className="block text-[11px] text-[var(--ink-muted)]" htmlFor="sync-unlock">
        Passphrase
      </label>
      <div className="flex gap-2">
        <input
          id="sync-unlock"
          type="password"
          value={passphrase}
          onChange={(event) => setPassphrase(event.target.value)}
          className="min-w-0 flex-1 rounded-md border border-[var(--hairline)] bg-transparent px-2 py-1 text-xs"
        />
        <button
          type="button"
          disabled={busy || passphrase.length === 0}
          onClick={() => void onOpen(passphrase)}
          className="rounded-md px-3 py-1.5 text-xs font-medium hover:bg-black/5 disabled:opacity-50 dark:hover:bg-white/10"
        >
          Open
        </button>
      </div>
    </div>
  );
}
