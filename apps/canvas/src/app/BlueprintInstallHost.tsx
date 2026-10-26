import type { WorkspaceDocument } from "@suite/graph";
import { useRef } from "react";
import { createPortal } from "react-dom";
import { installBlueprintCard, readBlueprint } from "../canvas/blueprints/blueprint";
import { useFocusTrap } from "../dialogs/useFocusTrap";
import { messageFor } from "../i18n";
import { BlueprintInstallPanel } from "../panels/BlueprintInstallPanel";
import { useEscapeLayer } from "../shell/escapeLayers";
import { useUiStore } from "../store/useUiStore";

/**
 * Where a blueprint install happens (ADR-0059).
 *
 * The palette's `type.installBlueprint` row names the card the reader has open; the
 * type itself is written in that card's title and body, so the row opens this panel
 * instead of installing something the reader has not seen. The panel previews the
 * plan (one checkbox per field, plus the starter content) and the install is one
 * `installBlueprintCard` call, which is the same function the board's
 * `installBlueprintSelection` runs, so the two cannot install different things.
 *
 * A card that is not a blueprint says why here rather than opening an empty panel:
 * the reason is `readBlueprint`'s own code, in the catalogue's words.
 */
export interface BlueprintInstallHostProps {
  workspace: WorkspaceDocument;
}

export function BlueprintInstallHost({ workspace }: BlueprintInstallHostProps) {
  const cardId = useUiStore((state) => state.blueprintCardId);
  const close = useUiStore((state) => state.closeBlueprintInstall);
  const panel = useRef<HTMLDivElement | null>(null);

  useEscapeLayer(close, cardId !== null);
  useFocusTrap(panel, cardId !== null);

  if (cardId === null) return null;

  const read = readBlueprint({
    title: plainTitle(workspace, cardId),
    body: workspace.peekContent(cardId)?.toJSON() ?? null,
  });
  const existingType = read.ok
    ? (workspace.listTypes().find((type) => type.name === read.spec.name) ?? null)
    : null;

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-center justify-center">
      <button
        type="button"
        aria-label="Close the blueprint panel"
        className="absolute inset-0 cursor-default border-0 bg-black/25 backdrop-blur-[2px]"
        onClick={close}
      />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label="Install a type from this card"
        tabIndex={-1}
        data-testid="blueprint-install-dialog"
        className="relative w-[min(400px,calc(100vw-2rem))] rounded-xl border border-[var(--hairline)] bg-[var(--surface)] p-4 shadow-xl outline-none"
      >
        {read.ok ? (
          <div className="flex flex-col gap-3">
            <BlueprintInstallPanel
              spec={read.spec}
              existingType={existingType}
              // One call writes the chosen units in one undoable batch, the same
              // read, plan and apply the board's install runs; the panel closes
              // behind it because the document now says what was chosen.
              onInstall={(parts) => {
                installBlueprintCard(workspace, cardId, parts);
                close();
              }}
            />
            <div className="flex justify-end">
              <button
                type="button"
                className="rounded-md px-3 py-1.5 text-xs text-[var(--ink-muted)] transition-colors hover:bg-black/5 dark:hover:bg-white/10"
                onClick={close}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <h2 className="text-sm font-semibold">This card is not a blueprint</h2>
            <p
              className="text-xs leading-relaxed text-[var(--ink-muted)]"
              data-testid="blueprint-install-reason"
            >
              {messageFor(read.code, read.params)}
            </p>
            <div className="flex justify-end">
              <button
                type="button"
                className="rounded-md bg-[var(--ink)] px-3 py-1.5 text-xs text-[var(--surface)] transition-colors hover:opacity-90"
                onClick={close}
              >
                Close
              </button>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

/**
 * The card's title as plain text, which is the read `installBlueprintCard` performs.
 * `displayTitle` is the wrong input here: it falls back to the body, and a card whose
 * title is empty declares no type name at all.
 */
function plainTitle(workspace: WorkspaceDocument, cardId: string): string | null {
  const text = textOf(workspace.peekTitle(cardId)?.toJSON() ?? null).trim();
  return text === "" ? null : text;
}

function textOf(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value !== "object" || value === null) return "";
  const node = value as { text?: unknown; children?: unknown };
  if (typeof node.text === "string") return node.text;
  const children = Array.isArray(node.children) ? node.children : [];
  return children.map(textOf).join("");
}
