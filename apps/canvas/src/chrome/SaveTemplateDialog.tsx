import type { WorkspaceDocument } from "@suite/graph";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useFocusTrap } from "../dialogs/useFocusTrap";
import { useEscapeLayer } from "../shell/escapeLayers";
import {
  saveWorkspaceTemplate,
  type TemplateSaveOutcome,
  type TemplateSaveStage,
  templateSavedNotice,
} from "../templates/captureClient";

export interface SaveTemplateDialogProps {
  /** The open document. Captured through the typed layer. */
  workspace: WorkspaceDocument;
  /** The workspace's title, offered as the template's name. */
  title: string;
  onClose: () => void;
  /** Handed the one-line result so the app bar can keep saying it. */
  onSaved?: (notice: string) => void;
  /** Tests replace the capture, so no document and no network are involved. */
  save?: typeof saveWorkspaceTemplate;
}

const STAGE_COPY: Record<TemplateSaveStage, string> = {
  capturing: "Reading the boards and their pictures…",
  uploading: "Uploading the template…",
};

/**
 * The one prompt for turning the open workspace into a starter template.
 *
 * It asks for the two things a gallery row needs — a name and one line about
 * what choosing it produces — and then shows what the capture is doing. The
 * result stays on screen: a saved template is not a reason to close the window
 * the operator is working in, and the pictures are the part they want confirmed.
 */
export function SaveTemplateDialog({
  workspace,
  title,
  onClose,
  onSaved,
  save = saveWorkspaceTemplate,
}: SaveTemplateDialogProps) {
  const [name, setName] = useState(title);
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState<TemplateSaveStage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<TemplateSaveOutcome | null>(null);
  const input = useRef<HTMLInputElement | null>(null);
  const panel = useRef<HTMLDivElement | null>(null);

  useEscapeLayer(onClose);
  useFocusTrap(panel);
  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);

  const canSave = name.trim().length > 0 && !busy;
  // Once it is saved the same button reads "Done": the dialog has nothing left
  // to write, and closing it is the only thing on offer.
  const canPress = saved === null ? canSave : true;

  const submit = async () => {
    if (!canSave || saved !== null) return;
    setBusy(true);
    setError(null);
    setStage("capturing");
    const outcome = await save({
      workspace,
      name,
      description,
      onStage: setStage,
    });
    setBusy(false);
    setStage(null);
    if (!outcome.ok) {
      setError(outcome.message);
      return;
    }
    setSaved(outcome);
  };

  const done = () => {
    if (saved?.ok) onSaved?.(templateSavedNotice(saved));
    onClose();
  };

  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-center justify-center">
      <button
        type="button"
        aria-label="Close dialog"
        className="absolute inset-0 cursor-default border-0 bg-black/25 backdrop-blur-[2px]"
        onClick={busy ? undefined : onClose}
      />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label="Save as a starter template"
        tabIndex={-1}
        data-testid="save-template-dialog"
        className="relative w-[min(440px,calc(100vw-2rem))] rounded-xl border border-[var(--hairline)] bg-[var(--surface)] p-4 shadow-xl"
      >
        <h2 className="text-sm font-semibold">Save as a starter template</h2>
        <p className="mt-2 text-xs leading-relaxed text-[var(--ink-muted)]">
          Every board, region, card and picture in this workspace is copied into the template, so a
          new workspace can start from it. Nothing here changes.
        </p>

        <label
          className="mt-3 block text-[11px] text-[var(--ink-muted)]"
          htmlFor="save-template-name"
        >
          Template name
        </label>
        <input
          id="save-template-name"
          ref={input}
          data-testid="save-template-name"
          className="mt-1 w-full rounded-md border border-[var(--hairline)] bg-[var(--surface)] px-2 py-1.5 text-xs"
          value={name}
          disabled={busy || saved !== null}
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => setName(event.target.value)}
        />

        <label
          className="mt-3 block text-[11px] text-[var(--ink-muted)]"
          htmlFor="save-template-description"
        >
          Description (optional)
        </label>
        <input
          id="save-template-description"
          data-testid="save-template-description"
          className="mt-1 w-full rounded-md border border-[var(--hairline)] bg-[var(--surface)] px-2 py-1.5 text-xs"
          value={description}
          placeholder="What choosing this produces"
          disabled={busy || saved !== null}
          autoComplete="off"
          onChange={(event) => setDescription(event.target.value)}
        />

        {stage !== null ? (
          <p
            role="status"
            data-testid="save-template-progress"
            className="mt-2 text-[11px] text-[var(--ink-muted)]"
          >
            {STAGE_COPY[stage]}
          </p>
        ) : null}
        {error ? (
          <p
            role="alert"
            data-testid="save-template-error"
            className="mt-2 rounded-lg border border-red-500/30 bg-red-500/10 px-2 py-1.5 text-[11px] text-red-600 dark:text-red-300"
          >
            {error}
          </p>
        ) : null}
        {saved?.ok ? (
          <p
            role="status"
            data-testid="save-template-saved"
            className="mt-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-2 py-1.5 text-[11px] text-emerald-700 dark:text-emerald-300"
          >
            {templateSavedNotice(saved)}
          </p>
        ) : null}

        <div className="mt-4 flex items-center justify-end gap-1.5">
          {saved === null ? (
            <button
              type="button"
              data-testid="save-template-cancel"
              disabled={busy}
              className="rounded-md border border-[var(--hairline)] px-2.5 py-1 text-[11px] text-[var(--ink-muted)] hover:bg-black/5 hover:text-[var(--ink)] disabled:opacity-40 dark:hover:bg-white/10"
              onClick={onClose}
            >
              Cancel
            </button>
          ) : null}
          <button
            type="button"
            data-testid="save-template-submit"
            disabled={!canPress}
            className="rounded-md bg-[var(--ink)] px-2.5 py-1 text-[11px] text-[var(--surface)] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
            onClick={() => (saved === null ? void submit() : done())}
          >
            {saved !== null ? "Done" : busy ? "Saving…" : "Save template"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
