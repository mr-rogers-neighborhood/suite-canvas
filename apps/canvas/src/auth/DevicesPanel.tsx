import { useCallback, useEffect, useState } from "react";
import {
  type DeviceSession,
  deviceLabel,
  listDevices,
  revokeDevice,
  revokeOtherDevices,
} from "./devices";

/**
 * Signed-in browsers (ADR-0074).
 *
 * Revoking a session is the only remote sign-out there is: the row goes, the next
 * token mint fails, and the device's socket drops within the JWT's five-minute
 * life. The list therefore says what happened rather than implying an instant
 * disconnect.
 */

function when(timestamp: number | null): string {
  if (timestamp === null) return "an unknown time";
  return new Date(timestamp).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export interface DevicesPanelProps {
  /** Overrides the reads; tests supply their own. */
  api?: {
    listDevices: typeof listDevices;
    revokeDevice: typeof revokeDevice;
    revokeOtherDevices: typeof revokeOtherDevices;
  };
}

const liveApi = { listDevices, revokeDevice, revokeOtherDevices };

export function DevicesPanel({ api = liveApi }: DevicesPanelProps) {
  const [sessions, setSessions] = useState<DeviceSession[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    const listed = await api.listDevices();
    if (listed.ok) setSessions(listed.value);
    else setError(listed.message);
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  const revoke = async (session: DeviceSession) => {
    setBusy(true);
    setError(null);
    const result = await api.revokeDevice(session.id);
    setBusy(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setNotice(
      `Signed out ${deviceLabel(session.userAgent)}. Its socket drops within five minutes.`,
    );
    void load();
  };

  const revokeOthers = async () => {
    setBusy(true);
    setError(null);
    const result = await api.revokeOtherDevices();
    setBusy(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setNotice("Every other browser is signed out. This one stays.");
    void load();
  };

  const others = sessions.filter((session) => !session.current).length;

  return (
    <div data-testid="devices-panel" className="text-[12px]">
      <h3 className="text-[13px] font-semibold">Where you are signed in</h3>
      <p className="mt-1 leading-5 text-[var(--ink-muted)]">
        Every browser signed in to your account. Removing one signs it out within a few minutes.
      </p>

      <ul data-testid="devices-list" className="mt-2 divide-y divide-[var(--hairline)]">
        {sessions.length === 0 ? (
          <li className="py-2 text-[var(--ink-muted)]">Nowhere else. This is the only browser.</li>
        ) : (
          sessions.map((session) => (
            <li key={session.id} className="flex items-center gap-2 py-1.5">
              <span className="min-w-0 flex-1">
                <span className="block truncate">
                  {deviceLabel(session.userAgent)}
                  {session.current ? (
                    <span
                      data-testid="device-current"
                      className="ml-1 rounded bg-black/5 px-1 text-[10px] text-[var(--ink-muted)] dark:bg-white/10"
                    >
                      this device
                    </span>
                  ) : null}
                </span>
                <span className="block truncate text-[10px] text-[var(--ink-muted)]">
                  Last used {when(session.updatedAt)}
                  {session.ipAddress ? ` · ${session.ipAddress}` : ""}
                </span>
              </span>
              <button
                type="button"
                data-testid={`device-revoke-${session.id}`}
                disabled={busy || session.current}
                title={
                  session.current ? "This is the browser you are using" : "Sign this browser out"
                }
                onClick={() => void revoke(session)}
                className="rounded px-1.5 py-0.5 text-[11px] text-red-600 hover:bg-red-50 disabled:opacity-30 dark:text-red-300 dark:hover:bg-red-500/15"
              >
                Revoke
              </button>
            </li>
          ))
        )}
      </ul>

      {others > 0 ? (
        <button
          type="button"
          data-testid="devices-revoke-others"
          disabled={busy}
          onClick={() => void revokeOthers()}
          className="mt-2 rounded-lg border border-[var(--hairline)] px-2.5 py-1 text-[11px] disabled:opacity-50"
        >
          Sign out every other device
        </button>
      ) : null}

      {notice === null ? null : (
        <p role="status" data-testid="devices-notice" className="mt-2 text-[11px]">
          {notice}
        </p>
      )}
      {error === null ? null : (
        <p
          role="alert"
          data-testid="devices-error"
          className="mt-2 rounded-lg border border-red-500/40 bg-red-500/10 px-2 py-1.5 text-[11px] text-red-800 dark:text-red-200"
        >
          {error}
        </p>
      )}
    </div>
  );
}
