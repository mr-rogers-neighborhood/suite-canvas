#!/usr/bin/env node
/**
 * Opens the ICE surface in a headed Chrome, or reports the WebGPU adapter that
 * Chrome can actually reach.
 *
 * Why a dedicated launcher: the ICE canvas asks for a WebGPU adapter at boot.
 * An integrated browser pane hands out none, so the HUD stays on
 * `engine: degraded` there. A headed Chrome started with `--enable-unsafe-webgpu`
 * does hand one out, which makes that window the only honest manual test surface.
 * `--probe` reports the adapter and whether it is hardware or SwiftShader.
 *
 * Usage: node scripts/ice-chrome.mjs [--probe|--help]
 */
// biome-ignore-all lint/suspicious/noUndeclaredEnvVars: a root-level launcher, not a turbo task, so
// SUITE_CHROME / SUITE_DEV_URL / SUITE_ICE_* never enter turbo's cache key.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { createServer as createSocketServer } from "node:net";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const PROFILE_ROOT = join(root, ".ice-chrome-profile");
const DEFAULT_DEV_URL = "http://localhost:5173";
const DEV_READY_TIMEOUT_MS = 30_000;
const PROBE_TIMEOUT_MS = 25_000;

const HELP = `ICE headed-Chrome launcher

Usage:
  node scripts/ice-chrome.mjs            Open the ICE surface in headed Chrome
  node scripts/ice-chrome.mjs --probe    Start Chrome, read the WebGPU adapter, exit
  node scripts/ice-chrome.mjs --help     Show this text

Launch:
  Ensures a dev server answers on SUITE_DEV_URL, then opens
  <dev-url>/ice.html
  in headed Chrome with a fresh per-launch profile under .ice-chrome-profile/.

Chrome flags:
  --enable-unsafe-webgpu --enable-features=Vulkan --use-angle=vulkan
  --enable-unsafe-swiftshader (fallback for machines without a Vulkan driver)
  SUITE_ICE_CHROME_ARGS adds to these.

Environment:
  SUITE_CHROME            Chrome binary to run. Default: the first of
                          google-chrome-stable, google-chrome, chromium on PATH.
  SUITE_DEV_URL           Dev server to open. Default: ${DEFAULT_DEV_URL}
                          If nothing answers there, the launcher starts
                          \`pnpm --filter @suite/canvas dev\` and waits up to 30s.
                          An existing server is reused and never stopped.
  SUITE_ICE_CHROME_ARGS   Extra Chrome flags, space-separated.
  SUITE_ICE_PROBE_HEADLESS  Set to 1 to run --probe without a window. Headless
                            Chrome reports SwiftShader, so this is for quiet
                            checks, not for judging the real adapter.
`;

/** DevTools expression: report what WebGPU looks like from inside the page. */
const PROBE_EXPRESSION = `(async () => {
  const report = { hasGpu: false, adapter: null, reason: null };
  if (typeof navigator === "undefined" || navigator.gpu == null) {
    report.reason = "navigator.gpu is undefined";
    return report;
  }
  report.hasGpu = true;
  try {
    const adapter = await navigator.gpu.requestAdapter();
    if (adapter == null) {
      report.reason = "requestAdapter() returned null";
      return report;
    }
    const info = adapter.info ?? null;
    report.adapter = {
      vendor: info?.vendor ?? "",
      architecture: info?.architecture ?? "",
      device: info?.device ?? "",
      description: info?.description ?? "",
      fallback: info?.isFallback ?? null,
      featureCount: adapter.features ? adapter.features.size : 0,
    };
    return report;
  } catch (error) {
    report.reason = error?.message ? String(error.message) : String(error);
    return report;
  }
})()`;

const PROBE_PAGE = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>ICE WebGPU probe</title></head>
  <body>Probing WebGPU…</body>
</html>`;

function messageOf(error) {
  return error instanceof Error ? error.message : String(error);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} did not finish within ${ms / 1000}s`)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

function findOnPath(name) {
  const dirs = (process.env.PATH ?? "").split(delimiter).filter(Boolean);
  for (const dir of dirs) {
    const candidate = join(dir, name);
    try {
      if (existsSync(candidate)) return candidate;
    } catch {
      // An unreadable PATH entry is not an answer; keep looking.
    }
  }
  return null;
}

/**
 * `SUITE_CHROME` wins, then the three Linux names in the order Chrome's own
 * packages install them, then the macOS bundles.
 */
function detectChrome() {
  const override = (process.env.SUITE_CHROME ?? "").trim();
  if (override) {
    if (!existsSync(override)) {
      throw new Error(`SUITE_CHROME points at ${override}, which does not exist.`);
    }
    return override;
  }

  const bundlePaths =
    process.platform === "darwin"
      ? [
          "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
          "/Applications/Chromium.app/Contents/MacOS/Chromium",
        ]
      : [];

  for (const candidate of bundlePaths) {
    if (existsSync(candidate)) return candidate;
  }
  for (const name of ["google-chrome-stable", "google-chrome", "chromium"]) {
    const found = findOnPath(name);
    if (found !== null) return found;
  }
  throw new Error(
    "No Chrome found. Install google-chrome-stable, google-chrome, or chromium, " +
      "or set SUITE_CHROME to the binary you want.",
  );
}

function extraArgs() {
  const raw = (process.env.SUITE_ICE_CHROME_ARGS ?? "").trim();
  return raw.length === 0 ? [] : raw.split(/\s+/);
}

/**
 * Flags every launch gets: profile isolation plus the WebGPU escape hatches.
 * `--enable-features=Vulkan` is the one that matters on this machine: without
 * it Chrome only offers SwiftShader; with it, the NVIDIA adapter appears.
 * `--enable-unsafe-swiftshader` stays as the fallback for machines with no
 * usable Vulkan driver.
 */
function chromeBaseArgs(profileDir) {
  return [
    `--user-data-dir=${profileDir}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--enable-unsafe-webgpu",
    "--enable-features=Vulkan",
    "--use-angle=vulkan",
    "--enable-unsafe-swiftshader",
    // A backgrounded window can let Chrome recycle the GPU device; the ICE
    // desk then reports a lost external instance. Keep the demo window live.
    "--disable-backgrounding-occluded-windows",
    "--disable-renderer-backgrounding",
    "--disable-background-timer-throttling",
    // NVIDIA compositing is steadier on X11 here; Wayland is still available
    // by overriding SUITE_ICE_CHROME_ARGS with --ozone-platform=wayland.
    ...(process.platform === "linux" ? ["--ozone-platform=x11"] : []),
    ...extraArgs(),
  ];
}

function devUrlFromEnv() {
  const raw = (process.env.SUITE_DEV_URL ?? "").trim() || DEFAULT_DEV_URL;
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `http://${raw}`;
  try {
    return new URL(withScheme).toString().replace(/\/$/, "");
  } catch {
    throw new Error(`SUITE_DEV_URL is not a usable URL: ${raw}`);
  }
}

async function reachable(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(2000) });
    await response.body?.cancel();
    return true;
  } catch {
    return false;
  }
}

/**
 * Reuses whatever already answers on the dev URL. A server this script starts
 * is detached on purpose: the window outlives the command, so the server must
 * too, and an existing server must never be stopped on exit.
 */
async function ensureDevServer(devUrl) {
  if (await reachable(devUrl)) {
    console.log(`Dev server: reusing the one already answering on ${devUrl}`);
    return;
  }

  console.log(`Dev server: nothing on ${devUrl}, starting \`pnpm --filter @suite/canvas dev\``);
  const child = spawn("pnpm", ["--filter", "@suite/canvas", "dev"], {
    cwd: root,
    detached: true,
    stdio: "ignore",
  });
  await new Promise((resolve, reject) => {
    child.once("error", (error) =>
      reject(new Error(`Could not start the dev server: ${messageOf(error)}`)),
    );
    child.once("spawn", resolve);
  });
  child.unref();

  const deadline = Date.now() + DEV_READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (await reachable(devUrl)) {
      console.log(`Dev server: ready on ${devUrl}`);
      return;
    }
    await sleep(400);
  }
  throw new Error(
    `The dev server never answered on ${devUrl} (waited ${DEV_READY_TIMEOUT_MS / 1000}s). ` +
      "Start it yourself with `pnpm --filter @suite/canvas dev` and re-run; " +
      "set SUITE_DEV_URL if Vite picked another port.",
  );
}

async function freePort() {
  const server = createSocketServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  const port = typeof address === "object" && address !== null ? address.port : 0;
  await new Promise((resolve) => server.close(resolve));
  if (port === 0) throw new Error("Could not reserve a local port for the probe page.");
  return port;
}

async function startProbePage() {
  const server = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(PROBE_PAGE);
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  const port = typeof address === "object" && address !== null ? address.port : 0;
  return {
    url: `http://127.0.0.1:${port}/`,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

/** Poll DevTools until the probe page exists, so a failed launch is explained. */
async function waitForDebugTarget(debugPort, targetUrl, child) {
  const deadline = Date.now() + PROBE_TIMEOUT_MS;
  let lastError = null;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Chrome exited with code ${child.exitCode} before opening the probe page`);
    }
    try {
      const response = await fetch(`http://127.0.0.1:${debugPort}/json/list`, {
        signal: AbortSignal.timeout(1000),
      });
      const targets = await response.json();
      const pages = targets.filter(
        (target) => target.type === "page" && typeof target.webSocketDebuggerUrl === "string",
      );
      const target =
        pages.find((page) => page.url === targetUrl) ??
        pages.find((page) => page.url.startsWith("http://127.0.0.1:")) ??
        pages[0];
      if (target !== undefined) return target;
    } catch (error) {
      lastError = error;
    }
    await sleep(150);
  }
  throw new Error(
    `Chrome never exposed a page on its DevTools port ${debugPort}` +
      (lastError === null ? "" : ` (last error: ${messageOf(lastError)})`),
  );
}

async function connectCdp(wsUrl) {
  const socket = new WebSocket(wsUrl);
  const pending = new Map();
  let nextId = 1;

  await new Promise((resolve, reject) => {
    socket.addEventListener("open", () => resolve(), { once: true });
    socket.addEventListener("error", () => reject(new Error("DevTools socket failed to open")), {
      once: true,
    });
  });

  socket.addEventListener("message", (event) => {
    let message;
    try {
      message = JSON.parse(event.data);
    } catch {
      return;
    }
    const entry = pending.get(message.id);
    if (entry === undefined) return;
    pending.delete(message.id);
    if (message.error) entry.reject(new Error(message.error.message ?? "DevTools call failed"));
    else entry.resolve(message.result);
  });

  return {
    send(method, params) {
      const id = nextId++;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        socket.send(JSON.stringify({ id, method, params }));
      });
    },
    close() {
      pending.clear();
      socket.close();
    },
  };
}

/**
 * The DevTools target shows the probe URL while it is still on `about:blank`,
 * and `navigator.gpu` only appears once the real document commits. So wait for
 * the document, then retry until the binding shows up.
 */
async function waitForPage(cdp, pageUrl) {
  const deadline = Date.now() + 10_000;
  let href = null;
  while (Date.now() < deadline) {
    try {
      const state = await cdp.send("Runtime.evaluate", {
        expression: "({ href: location.href, ready: document.readyState })",
        returnByValue: true,
      });
      const value = state.result?.value ?? {};
      href = typeof value.href === "string" ? value.href : null;
      if (href === pageUrl && value.ready === "complete") return;
    } catch {
      // A context torn down mid-navigation simply gets another turn.
    }
    await sleep(100);
  }
  throw new Error(`the probe page never finished loading (last location: ${href ?? "unknown"})`);
}

async function evaluateProbeReady(cdp) {
  const deadline = Date.now() + 8000;
  let report = null;
  while (Date.now() < deadline) {
    try {
      report = await evaluateProbe(cdp);
    } catch {
      report = null;
    }
    if (report?.hasGpu) return report;
    await sleep(250);
  }
  return report;
}

async function evaluateProbe(cdp) {
  const result = await cdp.send("Runtime.evaluate", {
    expression: PROBE_EXPRESSION,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) {
    const detail = result.exceptionDetails.exception?.description ?? result.exceptionDetails.text;
    throw new Error(`The probe page threw: ${String(detail)}`);
  }
  return result.result?.value ?? null;
}

function reportProbe(report) {
  console.log("ICE WebGPU probe");
  if (report === null || typeof report !== "object") {
    console.log("  result:  the page returned nothing to read");
    return;
  }
  if (!report.hasGpu) {
    console.log(`  navigator.gpu:  absent (${report.reason ?? "unknown reason"})`);
    console.log("  adapter:        none — this Chrome build exposes no WebGPU at all");
    return;
  }

  const adapter = report.adapter;
  if (adapter === null || adapter === undefined) {
    console.log(`  navigator.gpu:  present, but no adapter (${report.reason ?? "no detail"})`);
    console.log("  adapter:        none");
    return;
  }

  const named =
    adapter.description ||
    [adapter.vendor, adapter.architecture, adapter.device].filter(Boolean).join(" ") ||
    "(adapter reports no name)";
  const software =
    adapter.fallback === true || /swiftshader|llvmpipe|software|subzero/i.test(named);

  console.log("  navigator.gpu:  present");
  console.log(`  adapter:        ${named}`);
  console.log(`  vendor:         ${adapter.vendor || "(not reported)"}`);
  console.log(`  architecture:   ${adapter.architecture || "(not reported)"}`);
  console.log(`  device:         ${adapter.device || "(not reported)"}`);
  console.log(
    `  fallback:       ${adapter.fallback === null ? "(not reported)" : adapter.fallback}`,
  );
  console.log(`  features:       ${adapter.featureCount}`);
  console.log(
    `  verdict:        ${
      software
        ? "software rasteriser — ICE runs, but expect slow frames"
        : "hardware — ICE should run at full speed"
    }`,
  );
}

/**
 * Cheap end-to-end check that Chrome really can hand out an adapter. Headed by
 * default, because that is what the launcher opens: headless Chrome has no
 * compositor to put a Vulkan device behind, so it reports SwiftShader whatever
 * the flags say. SUITE_ICE_PROBE_HEADLESS=1 keeps the checks quiet at the cost
 * of that accuracy.
 */
async function runProbe(chrome) {
  const profile = join(PROFILE_ROOT, `probe-${process.pid}`);
  const page = await startProbePage();
  let child = null;
  let cdp = null;

  try {
    mkdirSync(profile, { recursive: true });
    const debugPort = await freePort();
    const headless = process.env.SUITE_ICE_PROBE_HEADLESS === "1";
    const args = [
      ...chromeBaseArgs(profile),
      ...(headless ? ["--headless=new", "--disable-gpu-sandbox"] : ["--window-size=480,360"]),
      `--remote-debugging-port=${debugPort}`,
      page.url,
    ];
    console.log(
      `Probe: launching ${chrome} (${
        headless ? "headless — software adapter expected" : "headed, same flags as a launch"
      })`,
    );
    child = spawn(chrome, args, { cwd: root, stdio: "ignore" });

    const target = await waitForDebugTarget(debugPort, page.url, child);
    cdp = await withTimeout(
      connectCdp(target.webSocketDebuggerUrl),
      5000,
      "the DevTools connection",
    );
    await withTimeout(waitForPage(cdp, page.url), PROBE_TIMEOUT_MS, "the probe page");
    const report = await withTimeout(evaluateProbeReady(cdp), PROBE_TIMEOUT_MS, "the WebGPU probe");
    reportProbe(report);
  } catch (error) {
    // The probe is a diagnostic: a failure here must not imply the launcher is broken.
    console.error(`Probe could not complete: ${messageOf(error)}`);
    console.error(
      "The launcher itself is unaffected. Retry with " +
        "`SUITE_ICE_CHROME_ARGS='--no-sandbox' node scripts/ice-chrome.mjs --probe` if Chrome refused to start.",
    );
  } finally {
    cdp?.close();
    if (child !== null && child.exitCode === null) child.kill("SIGKILL");
    await page.close();
    try {
      rmSync(profile, { recursive: true, force: true });
    } catch {
      // A profile directory left behind is scratch space, not a failure.
    }
  }
}

/** Starts Chrome detached so the window outlives this command. */
async function launchHeaded(chrome, url) {
  mkdirSync(PROFILE_ROOT, { recursive: true });
  const profile = join(PROFILE_ROOT, `launch-${Date.now()}`);
  mkdirSync(profile, { recursive: true });
  const args = [...chromeBaseArgs(profile), url];
  const child = spawn(chrome, args, { cwd: root, detached: true, stdio: "ignore" });

  await new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, 3000);
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(new Error(`Could not start ${chrome}: ${messageOf(error)}`));
    });
    child.once("spawn", () => {
      clearTimeout(timer);
      resolve();
    });
  });
  child.unref();
  return profile;
}

async function runLaunch(chrome) {
  const devUrl = devUrlFromEnv();
  await ensureDevServer(devUrl);

  const url = `${devUrl}/ice.html`;

  const profile = await launchHeaded(chrome, url);

  console.log("");
  console.log("URL:");
  console.log(`  ${url}`);
  console.log("");
  console.log(`Chrome:  ${chrome}`);
  console.log(`Profile: ${profile}`);
  console.log("");
  console.log('The integrated browser cannot run ICE: the HUD stalls on "engine: degraded".');
  console.log("Headless Chrome only reaches a software adapter, so it cannot stand in for");
  console.log("this window either. The headed window opened above is the test surface —");
  console.log('watch its HUD for "engine: ready".');
  console.log("The window and any dev server started above keep running after this exits.");
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    console.log(HELP);
    return;
  }
  const unknown = args.filter((arg) => arg !== "--probe");
  if (unknown.length > 0) {
    throw new Error(`Unknown argument: ${unknown[0]}\n\n${HELP}`);
  }
  if (process.platform === "win32") {
    throw new Error(
      "Windows is not supported by this launcher. Run Chrome yourself with " +
        "--enable-unsafe-webgpu and open the ICE URL printed by " +
        "`pnpm --filter @suite/canvas dev` plus ?canvas=ice.",
    );
  }

  const chrome = detectChrome();
  if (args.includes("--probe")) await runProbe(chrome);
  else await runLaunch(chrome);
}

await main().catch((error) => {
  console.error(`\nICE launcher failed: ${messageOf(error)}`);
  process.exitCode = 1;
});
