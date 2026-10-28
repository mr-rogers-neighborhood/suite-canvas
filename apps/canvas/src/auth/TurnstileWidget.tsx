import { useEffect, useRef } from "react";

/**
 * Cloudflare Turnstile, loaded from Cloudflare's script (ADR-0077).
 *
 * Open sign-up needs one thing standing between a form and an account farm, and
 * the deployment already made this choice: `signUp.email` carries a
 * `x-captcha-response` header the server's captcha plugin verifies. The widget is
 * invisible in its managed mode, so a reader sees nothing unless Cloudflare
 * decides to ask.
 *
 * No dependency: the script is 30 lines of loader, and a package for it would be a
 * second thing to keep in step with the server's `provider`.
 */

const SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
const SCRIPT_ID = "suite-turnstile";

interface TurnstileApi {
  render: (
    container: HTMLElement,
    options: {
      sitekey: string;
      callback: (token: string) => void;
      "error-callback"?: () => void;
      "expired-callback"?: () => void;
      theme?: "auto" | "light" | "dark";
      size?: "normal" | "flexible" | "compact";
      appearance?: "always" | "interaction-only" | "execute";
    },
  ) => string;
  remove: (widgetId: string) => void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

function loadScript(): Promise<void> {
  if (typeof document === "undefined") return Promise.resolve();
  if (window.turnstile) return Promise.resolve();
  const existing = document.getElementById(SCRIPT_ID);
  if (existing) {
    return new Promise((resolve) => {
      existing.addEventListener("load", () => resolve(), { once: true });
    });
  }
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.id = SCRIPT_ID;
    script.src = SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.addEventListener("load", () => resolve(), { once: true });
    script.addEventListener("error", () => reject(new Error("turnstile-unavailable")), {
      once: true,
    });
    document.head.appendChild(script);
  });
}

export interface TurnstileWidgetProps {
  siteKey: string;
  /** The challenge answer, or `null` when it expired or failed. */
  onToken: (token: string | null) => void;
  /**
   * How much room the widget takes. `normal` is Cloudflare's 300px box, which is right
   * for a dialog and far too large inside a popover: `compact` is about half that.
   */
  size?: "normal" | "flexible" | "compact";
  /**
   * `interaction-only` keeps the widget invisible until Cloudflare wants an answer, so a
   * managed challenge that passes silently shows nothing at all. The default renders it,
   * because a form that silently verifies looks like a form that did nothing.
   */
  appearance?: "always" | "interaction-only" | "execute";
}

/**
 * Renders one widget and reports its token. A script that cannot load reports
 * `null` rather than blocking sign-up: the server refuses a sign-up with no
 * challenge, and its message is the one worth showing.
 */
export function TurnstileWidget({
  siteKey,
  onToken,
  size = "normal",
  appearance = "always",
}: TurnstileWidgetProps) {
  const container = useRef<HTMLDivElement | null>(null);
  const widget = useRef<string | null>(null);
  // The callback is read through a ref so the widget's lifetime depends on the site key
  // and nothing else. With `onToken` in the dependency list, a parent that passes an
  // inline arrow gets a fresh identity on every render, which removed the widget and
  // rendered a new one on each verification: "verifying", then it disappears, forever.
  const report = useRef(onToken);
  useEffect(() => {
    report.current = onToken;
  }, [onToken]);

  useEffect(() => {
    let live = true;
    void loadScript()
      .then(() => {
        if (!live || !container.current || !window.turnstile) return;
        widget.current = window.turnstile.render(container.current, {
          sitekey: siteKey,
          theme: "auto",
          size,
          appearance,
          callback: (token) => report.current(token),
          "expired-callback": () => report.current(null),
          "error-callback": () => report.current(null),
        });
      })
      .catch(() => report.current(null));
    return () => {
      live = false;
      const id = widget.current;
      widget.current = null;
      if (id !== null) window.turnstile?.remove(id);
    };
  }, [siteKey, size, appearance]);

  // The height follows the size: a compact challenge is ~60px tall and a normal one ~65,
  // but an `interaction-only` widget reserves nothing until it appears.
  return (
    <div
      ref={container}
      data-testid="turnstile"
      className={size === "compact" ? "mt-1 min-h-[60px]" : "mt-1 min-h-[65px]"}
    />
  );
}
