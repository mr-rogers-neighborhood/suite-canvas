import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { syncPresentation } from "../feedback/syncState";
import { useEscapeLayer } from "../shell/escapeLayers";
import { useCanvasStore } from "../store/useCanvasStore";
import { KitStep, LocalFace, SyncedFace, UnlockStep } from "./SyncFaces";
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
  /** Where the hub is, when nothing better is known. The hub's own report wins. */
  defaultHost?: string;
}

const LOCAL_HOST = "ws://127.0.0.1:8787/sync";

/** Which question the dialog is asking. One at a time, and each ends somewhere. */
type Step =
  | { readonly name: "main" }
  | { readonly name: "kit" }
  | { readonly name: "unlock"; path: string };

export function SyncDialog({ open, onClose, defaultHost = LOCAL_HOST }: SyncDialogProps) {
  const panel = useRef<HTMLDivElement | null>(null);
  const sync = useCanvasStore((state) => state.sync);
  const enableSync = useCanvasStore((state) => state.enableSync);
  const disableSync = useCanvasStore((state) => state.disableSync);
  const inviteSomeone = useCanvasStore((state) => state.inviteSomeone);
  const joinWorkspace = useCanvasStore((state) => state.joinWorkspace);
  const removeDevice = useCanvasStore((state) => state.removeDevice);
  const hub = useCanvasStore((state) => state.hub);
  const refreshHub = useCanvasStore((state) => state.refreshHub);
  const exportKit = useCanvasStore((state) => state.exportKit);
  const importKit = useCanvasStore((state) => state.importKit);
  const declineKit = useCanvasStore((state) => state.declineKit);

  const [host, setHost] = useState(defaultHost);
  const [link, setLink] = useState<string | null>(null);
  const [pasted, setPasted] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [step, setStep] = useState<Step>({ name: "main" });
  const [removing, setRemoving] = useState<string | null>(null);

  useEscapeLayer(onClose, open);
  useFocusTrap(panel, open);

  useEffect(() => {
    if (!open) return;
    setProblem(null);
    setStep({ name: "main" });
    // The hub reports where it listens, so sharing does not begin with copying an address out
    // of another window. A hub that is not running leaves the default in place and editable.
    void refreshHub().then(() => {
      const address = useCanvasStore.getState().hub?.address;
      if (address != null) setHost(address);
    });
  }, [open, refreshHub]);

  if (!open) return null;

  const state = sync?.status ?? null;
  const presentation = syncPresentation({ state, people: sync?.members.length ?? 0 });
  const shared = state !== null && state.state !== "off";
  const waiting = state?.state === "waiting";
  const removed = state?.state === "removed";
  // Offered once, right after a workspace becomes shared, and never again once answered: a
  // decline is a decision, not an outstanding chore.
  const offerKit = shared && !waiting && !removed && (sync?.kit ?? null) === null;

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

  const openKit = () =>
    run(async () => {
      const result = await importKit({});
      if (result.ok) return;
      if (result.reason === "passphrase") {
        setStep({ name: "unlock", path: result.path });
        return;
      }
      if (result.reason === "message") setProblem(result.message);
    });

  const face =
    step.name === "kit"
      ? "kit"
      : step.name === "unlock"
        ? "unlock"
        : removed
          ? "removed"
          : waiting
            ? "waiting"
            : shared
              ? "synced"
              : "local";

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
        data-face={face}
        className="relative w-[min(440px,calc(100vw-2rem))] rounded-xl border border-[var(--hairline)] bg-[var(--surface)] p-4 shadow-xl outline-none"
      >
        <h2 className="text-sm font-semibold">
          {step.name === "kit"
            ? "A way back in"
            : step.name === "unlock"
              ? "Open a recovery file"
              : "Sync"}
        </h2>
        <p className="mt-1.5 text-xs leading-relaxed text-[var(--ink-muted)]">
          {step.name === "kit"
            ? "The machine sharing this workspace cannot read it, so it cannot restore it. This file can: it is this device, kept somewhere you trust."
            : step.name === "unlock"
              ? "That file is sealed with a passphrase. Type it to open it."
              : presentation.sentence}
        </p>

        {step.name === "kit" ? (
          <KitStep
            busy={busy}
            onSave={(passphrase) =>
              run(async () => {
                const path = await exportKit(passphrase);
                if (path === null) return;
                setStep({ name: "main" });
              })
            }
            onDecline={() =>
              run(async () => {
                await declineKit();
                setStep({ name: "main" });
              })
            }
          />
        ) : step.name === "unlock" ? (
          <UnlockStep
            busy={busy}
            onOpen={(passphrase) =>
              run(async () => {
                const result = await importKit({ path: step.path, passphrase });
                if (result.ok) {
                  setStep({ name: "main" });
                  return;
                }
                if (result.reason === "message") setProblem(result.message);
              })
            }
          />
        ) : waiting || removed ? null : shared ? (
          <SyncedFace
            members={sync?.members ?? []}
            deviceId={sync?.deviceId ?? ""}
            link={link}
            busy={busy}
            offerKit={offerKit}
            removing={removing}
            onSaveKit={() => setStep({ name: "kit" })}
            onInvite={async () => {
              const made = await inviteSomeone("editor");
              setLink(made);
              if (made === null) setProblem("The invitation could not be written.");
            }}
            onRemove={async (deviceId) => {
              setRemoving(deviceId);
              const said = await removeDevice(deviceId);
              setRemoving(null);
              if (said !== null) setProblem(said);
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
            hubRunning={hub?.running ?? false}
            pasted={pasted}
            busy={busy}
            onHost={setHost}
            onPasted={setPasted}
            onShare={() => run(() => enableSync(host))}
            onJoin={() => run(() => joinWorkspace(pasted))}
            onRestore={openKit}
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
