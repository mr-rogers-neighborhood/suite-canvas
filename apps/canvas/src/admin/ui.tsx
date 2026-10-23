import { type ReactNode, useEffect, useRef, useState } from "react";
import { errorText } from "./api";

/** Loads once, and again whenever `reload` is called. */
export function useLoad<T>(load: () => Promise<T>): {
  data: T | null;
  error: string | null;
  loading: boolean;
  reload: () => void;
} {
  const [state, setState] = useState<{ data: T | null; error: string | null; loading: boolean }>({
    data: null,
    error: null,
    loading: true,
  });
  const [nonce, setNonce] = useState(0);
  const loadRef = useRef(load);
  loadRef.current = load;

  // `nonce` is the reload trigger: bumping it must re-run the loader.
  // biome-ignore lint/correctness/useExhaustiveDependencies: nonce is the trigger
  useEffect(() => {
    let cancelled = false;
    setState((previous) => ({ ...previous, loading: true, error: null }));
    loadRef.current().then(
      (data) => {
        if (!cancelled) setState({ data, error: null, loading: false });
      },
      (cause: unknown) => {
        if (!cancelled) {
          setState((previous) => ({
            data: previous.data,
            error: errorText(cause),
            loading: false,
          }));
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [nonce]);

  return { ...state, reload: () => setNonce((value) => value + 1) };
}

export function ErrorLine({ message }: { message: string | null }) {
  if (message === null) return null;
  return (
    <p className="admin-error" role="alert">
      {message}
    </p>
  );
}

export function Muted({ children }: { children: ReactNode }) {
  return <p className="admin-muted">{children}</p>;
}

export function PanelHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string | undefined;
  actions?: ReactNode;
}) {
  return (
    <header className="admin-panel-header">
      <div>
        <h2>{title}</h2>
        {description ? <p className="admin-muted">{description}</p> : null}
      </div>
      {actions ? <div className="admin-row-actions">{actions}</div> : null}
    </header>
  );
}

export function Button({
  children,
  onClick,
  disabled = false,
  tone = "default",
  title,
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  tone?: "default" | "danger" | "primary";
  title?: string;
}) {
  return (
    <button
      type="button"
      className={`admin-button admin-button-${tone}`}
      onClick={onClick}
      disabled={disabled}
      {...(title === undefined ? {} : { title })}
    >
      {children}
    </button>
  );
}

/**
 * A button that arms itself first. Destructive actions are one click plus one
 * confirmation, inline, with no modal to dismiss.
 */
export function ConfirmButton({
  label,
  confirmLabel,
  onConfirm,
  disabled = false,
  tone = "danger",
  title,
}: {
  label: string;
  confirmLabel: string;
  onConfirm: () => Promise<void>;
  disabled?: boolean;
  tone?: "default" | "danger";
  title?: string;
}) {
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!armed) return;
    const timer = window.setTimeout(() => setArmed(false), 5_000);
    return () => window.clearTimeout(timer);
  }, [armed]);

  const run = async () => {
    if (!armed) {
      setArmed(true);
      return;
    }
    setArmed(false);
    setBusy(true);
    try {
      await onConfirm();
    } catch {
      // The caller reports the failure on its single error line.
    } finally {
      setBusy(false);
    }
  };

  return (
    <Button
      onClick={() => void run()}
      disabled={disabled || busy}
      tone={armed ? "danger" : tone}
      {...(title === undefined ? {} : { title })}
    >
      {busy ? "Working…" : armed ? confirmLabel : label}
    </Button>
  );
}

/** Copies with the Clipboard API, falling back to a selection copy on plain HTTP. */
export function CopyButton({ value, label = "Copy" }: { value: string; label?: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");

  const copy = async () => {
    let copied = false;
    try {
      await navigator.clipboard.writeText(value);
      copied = true;
    } catch {
      const field = document.createElement("textarea");
      field.value = value;
      field.setAttribute("readonly", "");
      field.style.position = "fixed";
      field.style.opacity = "0";
      document.body.appendChild(field);
      field.select();
      try {
        copied = document.execCommand("copy");
      } catch {
        copied = false;
      } finally {
        field.remove();
      }
    }
    setState(copied ? "copied" : "failed");
    window.setTimeout(() => setState("idle"), 1_600);
  };

  return (
    <Button onClick={() => void copy()} disabled={state === "failed"}>
      {state === "copied" ? "Copied" : state === "failed" ? "Copy failed" : label}
    </Button>
  );
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** exponent;
  return `${value >= 10 || exponent === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[exponent]}`;
}

export function formatWhen(epochMs: number | null): string {
  if (epochMs === null || !Number.isFinite(epochMs)) return "—";
  const date = new Date(epochMs);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString();
}

export function formatUptime(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1_000));
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  if (days > 0) return `${days}d ${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${totalSeconds % 60}s`;
  return `${totalSeconds}s`;
}

export function shortId(value: string, keep = 18): string {
  return value.length <= keep ? value : `${value.slice(0, keep)}…`;
}
