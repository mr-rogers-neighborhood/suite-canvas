/**
 * Crash reporting is off until a person turns it on, and off entirely in a build
 * with no DSN. The preference lives in local storage so a reload does not
 * silently opt someone back in, and no cookie or server round trip is involved.
 */

const CONSENT_KEY = "suite-crash-consent";

function storage(): Storage | undefined {
  try {
    return typeof window === "undefined" ? undefined : window.localStorage;
  } catch {
    // A blocked storage partition is not an error worth surfacing here.
    return undefined;
  }
}

export function readCrashConsent(): boolean {
  try {
    return storage()?.getItem(CONSENT_KEY) === "yes";
  } catch {
    return false;
  }
}

export function setCrashConsent(granted: boolean): void {
  try {
    const store = storage();
    if (!store) return;
    if (granted) store.setItem(CONSENT_KEY, "yes");
    else store.removeItem(CONSENT_KEY);
  } catch {
    // Consent that cannot be stored is consent that does not survive a reload.
  }
}

/** The DSN baked into this build, if the operator configured one. */
export function crashDsn(): string | null {
  const dsn = import.meta.env.VITE_SUITE_CRASH_DSN;
  return typeof dsn === "string" && dsn.length > 0 ? dsn : null;
}

/** Crash reporting needs both halves: an endpoint and a person's permission. */
export function crashReportingAvailable(): boolean {
  return crashDsn() !== null;
}

export function crashReportingWanted(): boolean {
  return crashReportingAvailable() && readCrashConsent();
}
