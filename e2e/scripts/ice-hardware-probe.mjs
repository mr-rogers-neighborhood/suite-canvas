#!/usr/bin/env node
/**
 * ICE hardware probe: does Chrome 155 expose the real GPU to WebGPU on this box?
 *
 * Chrome on Linux gets a WebGPU adapter through Dawn -> Vulkan. When the GPU
 * process cannot bring up a Vulkan device it silently falls back to SwiftShader,
 * and `adapter.info` then reads `vendor: google, architecture: swiftshader`.
 * This script walks a matrix of flag/env combinations and reports, per combo,
 * whether `navigator.gpu` exists, whether an adapter came back, and what that
 * adapter claims to be.
 *
 * Two launch modes are used:
 *   pw     - `chromium.launch()` from @playwright/test, i.e. with Playwright's
 *            own default switches. Playwright pipes the browser's stderr into its
 *            own debug logger, so per-scenario stderr is only available from the
 *            renderer's console plus CDP SystemInfo.
 *   direct - `/usr/bin/google-chrome-stable` spawned by us with
 *            `--remote-debugging-port=0` and no Playwright switches, so the full
 *            Chrome stderr (vkCreateInstance, device lost, GPU process crashes)
 *            can be captured and filtered.
 *
 * Usage:
 *   node e2e/scripts/ice-hardware-probe.mjs             # full matrix, table
 *   node e2e/scripts/ice-hardware-probe.mjs --json      # machine-readable
 *   node e2e/scripts/ice-hardware-probe.mjs --only 3,6  # subset
 *   ICE_PROBE_URL=http://localhost:5175/ node ...       # any secure-context URL
 *
 * Exit code 0 whenever the matrix ran, even if no hardware adapter was found:
 * "SwiftShader only" is a valid, reportable result. Exit code 1 means the probe
 * itself could not run (no Chrome, no reachable dev server).
 *
 * Every launched browser is closed in a `finally` block, and the direct-mode
 * profile directories are removed, so no Chrome process outlives the run.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "@playwright/test";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const E2E_ROOT = path.resolve(HERE, "..");
const PROFILE_ROOT = path.join(E2E_ROOT, "test-results", "ice-probe");

const CHROME = process.env.ICE_CHROME ?? "/usr/bin/google-chrome-stable";
const TARGET_URL = process.env.ICE_PROBE_URL ?? "http://localhost:5175/?canvas=ice";
const NVIDIA_ICD = "/usr/share/vulkan/icd.d/nvidia_icd.json";

const argv = process.argv.slice(2);
const wantJson = argv.includes("--json");
const onlyArg = argv.find((a) => a.startsWith("--only"));
const only = new Set(
  (onlyArg ? (onlyArg.includes("=") ? onlyArg.split("=")[1] : argv[argv.indexOf(onlyArg) + 1]) : "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
);

// Chrome's Vulkan backend is only reachable when the GPU process is allowed to
// initialise Vulkan at all; the WebGPU feature flag alone is not enough.
const SAFE = ["--enable-unsafe-webgpu"];
const ANGLE_VULKAN = [
  ...SAFE,
  "--use-angle=vulkan",
  "--enable-features=Vulkan",
  "--ignore-gpu-blocklist",
];
const VULKAN_NATIVE = [
  ...ANGLE_VULKAN,
  "--use-vulkan=native",
  "--ozone-platform=x11",
  "--disable-gpu-sandbox",
];
const FULL = [
  ...VULKAN_NATIVE,
  "--disable-gpu-driver-bug-workarounds",
  "--enable-gpu-rasterization",
];

const scenarios = [
  { id: 1, combo: "unsafe-webgpu", mode: "pw", args: SAFE },
  // Is the Vulkan feature enough on its own? ANGLE and Dawn are separate
  // backends, so `--use-angle=vulkan` may be unrelated to WebGPU's adapter.
  { id: 9, combo: "features=Vulkan", mode: "pw", args: [...SAFE, "--enable-features=Vulkan"] },
  {
    id: 10,
    combo: "vulkan,no-blocklist",
    mode: "pw",
    args: [...SAFE, "--use-angle=vulkan", "--enable-features=Vulkan"],
  },
  { id: 2, combo: "angle=vulkan", mode: "pw", args: ANGLE_VULKAN },
  { id: 3, combo: "vulkan=native+x11", mode: "pw", args: VULKAN_NATIVE },
  { id: 4, combo: "no-bug-workarounds", mode: "pw", args: FULL },
  {
    id: 5,
    combo: "VK_ICD_FILENAMES",
    mode: "pw",
    args: FULL,
    env: { VK_ICD_FILENAMES: NVIDIA_ICD },
  },
  { id: 6, combo: "direct chrome", mode: "direct", args: FULL },
  {
    id: 7,
    combo: "direct + ICD env",
    mode: "direct",
    args: FULL,
    env: { VK_ICD_FILENAMES: NVIDIA_ICD },
  },
  {
    id: 8,
    combo: "direct wayland",
    mode: "direct",
    args: [...ANGLE_VULKAN, "--use-vulkan=native", "--disable-gpu-sandbox"],
    env: { VK_ICD_FILENAMES: NVIDIA_ICD },
  },
].filter((s) => only.size === 0 || only.has(String(s.id)));

/** Runs inside the page: everything WebGPU-shaped we can observe from JS. */
const PAGE_PROBE = async () => {
  const out = {
    gpu: typeof navigator.gpu !== "undefined",
    adapter: false,
    requestError: null,
    info: null,
    features: [],
    limits: null,
    webgl: null,
    device: false,
    deviceError: null,
  };

  try {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
    if (gl) {
      const ext = gl.getExtension("WEBGL_debug_renderer_info");
      out.webgl = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    }
  } catch {
    /* WebGL is only a secondary signal */
  }

  if (!out.gpu) return out;

  const withTimeout = (p, ms) =>
    Promise.race([
      p,
      new Promise((_, reject) => setTimeout(() => reject(new Error(`timeout after ${ms}ms`)), ms)),
    ]);

  let adapter = null;
  try {
    adapter = await withTimeout(
      navigator.gpu.requestAdapter({ powerPreference: "high-performance" }),
      15_000,
    );
  } catch (error) {
    out.requestError = String(error?.message ?? error);
  }
  if (!adapter) return out;
  out.adapter = true;

  try {
    out.info =
      adapter.info ??
      (typeof adapter.requestAdapterInfo === "function"
        ? await adapter.requestAdapterInfo()
        : null);
    if (out.info) {
      out.info = {
        vendor: out.info.vendor ?? "",
        architecture: out.info.architecture ?? "",
        device: out.info.device ?? "",
        description: out.info.description ?? "",
      };
    }
  } catch (error) {
    out.requestError = String(error?.message ?? error);
  }
  out.features = [...adapter.features].sort();
  out.limits = {
    maxBufferSize: adapter.limits?.maxBufferSize ?? null,
    maxTextureDimension2D: adapter.limits?.maxTextureDimension2D ?? null,
  };

  try {
    const device = await withTimeout(adapter.requestDevice(), 15_000);
    out.device = Boolean(device);
    device?.destroy?.();
  } catch (error) {
    out.deviceError = String(error?.message ?? error);
  }
  return out;
};

const isSwiftShader = (info) => {
  if (!info) return false;
  const hay =
    `${info.vendor} ${info.architecture} ${info.device} ${info.description}`.toLowerCase();
  return /swiftshader|llvmpipe|software/.test(hay) || info.vendor.toLowerCase() === "google";
};

const shortGl = (system) => {
  const renderer = system?.gpu?.auxAttributes?.glRenderer ?? "";
  const device = system?.gpu?.devices?.[0]?.deviceString ?? "";
  const hay = `${renderer} ${device}`.toLowerCase();
  if (/nvidia|10de/.test(hay)) return "nvidia";
  if (/intel|8086/.test(hay)) return "intel";
  if (/swiftshader|angle \(google/.test(hay)) return "swiftshader";
  return renderer ? renderer.slice(0, 12) : "?";
};

const STDERR_INTEREST =
  /vkCreateInstance|vulkan|dawn|webgpu|gpu process|device lost|angle|swiftshader|egl|gl_|error|fail/i;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function collect(page, browserCdp) {
  await page.goto(TARGET_URL, { waitUntil: "domcontentloaded", timeout: 30_000 });
  const data = await page.evaluate(PAGE_PROBE);
  let system = null;
  if (browserCdp) {
    try {
      system = await browserCdp.send("SystemInfo.getInfo");
    } catch {
      /* SystemInfo is browser-level and not always permitted */
    }
  }
  return { data, system };
}

async function runPlaywright(scenario) {
  const browser = await chromium.launch({
    executablePath: CHROME,
    headless: false,
    args: scenario.args,
    env: { ...process.env, ...scenario.env },
  });
  const stderr = [];
  try {
    const page = await browser.newPage();
    page.on("console", (msg) => {
      if (msg.type() === "error" && STDERR_INTEREST.test(msg.text()))
        stderr.push(`console: ${msg.text()}`);
    });
    let browserCdp = null;
    try {
      browserCdp = await browser.newBrowserCDPSession();
    } catch {
      /* optional */
    }
    const { data, system } = await collect(page, browserCdp);
    const version = browser.version();
    await page.close();
    return { data, system, stderr, version };
  } finally {
    await browser.close();
  }
}

function readDevToolsActivePort(profileDir, child) {
  return new Promise((resolve, reject) => {
    const portFile = path.join(profileDir, "DevToolsActivePort");
    const deadline = Date.now() + 25_000;
    const tick = () => {
      if (child.exitCode !== null) {
        reject(new Error(`chrome exited early with code ${child.exitCode}`));
        return;
      }
      if (fs.existsSync(portFile)) {
        const [port] = fs.readFileSync(portFile, "utf8").split("\n");
        if (port?.trim()) {
          resolve(Number(port.trim()));
          return;
        }
      }
      if (Date.now() > deadline) {
        reject(new Error("timed out waiting for DevToolsActivePort"));
        return;
      }
      setTimeout(tick, 100);
    };
    tick();
  });
}

async function runDirect(scenario) {
  const profileDir = path.join(PROFILE_ROOT, `profile-${scenario.id}-${process.pid}`);
  fs.rmSync(profileDir, { recursive: true, force: true });
  fs.mkdirSync(profileDir, { recursive: true });

  // No Playwright switches at all: a clean `google-chrome-stable` command line,
  // only the port/user-data-dir needed to attach over CDP.
  const args = [
    `--user-data-dir=${profileDir}`,
    "--remote-debugging-port=0",
    "--no-first-run",
    "--no-default-browser-check",
    "--enable-logging=stderr",
    ...scenario.args,
  ];
  const child = spawn(CHROME, args, {
    env: { ...process.env, ...scenario.env },
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });
  const stderr = [];
  const capture = (chunk) => {
    for (const line of String(chunk).split("\n")) {
      if (line.trim() && STDERR_INTEREST.test(line)) stderr.push(line.trim().slice(0, 300));
    }
  };
  child.stderr?.on("data", capture);
  child.stdout?.on("data", capture);

  let browser = null;
  try {
    const port = await readDevToolsActivePort(profileDir, child);
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    const context = browser.contexts()[0] ?? (await browser.newContext());
    const page = await context.newPage();
    let browserCdp = null;
    try {
      browserCdp = await browser.newBrowserCDPSession();
    } catch {
      /* optional */
    }
    const { data, system } = await collect(page, browserCdp);
    let version = "unknown";
    try {
      const v = await browserCdp.send("Browser.getVersion");
      version = String(v.product).replace(/^Chrome\//, "");
    } catch {
      /* optional */
    }
    await page.close();
    return { data, system, stderr, version, command: `${CHROME} ${args.join(" ")}` };
  } finally {
    if (browser) await browser.close().catch(() => {});
    // connectOverCDP's close asks Chrome to exit; make sure it actually did.
    for (let i = 0; i < 50 && child.exitCode === null; i++) await sleep(100);
    if (child.exitCode === null) {
      try {
        process.kill(child.pid, "SIGKILL");
      } catch {
        /* already gone */
      }
    }
    await sleep(150);
    fs.rmSync(profileDir, { recursive: true, force: true });
  }
}

function pad(value, width) {
  const text = String(value ?? "");
  return text.length >= width ? `${text.slice(0, Math.max(0, width - 1))}…` : text.padEnd(width);
}

async function main() {
  if (!fs.existsSync(CHROME)) {
    console.error(`probe: ${CHROME} not found (set ICE_CHROME)`);
    process.exit(1);
  }
  fs.mkdirSync(PROFILE_ROOT, { recursive: true });

  const rows = [];
  for (const scenario of scenarios) {
    const started = Date.now();
    let result;
    try {
      result =
        scenario.mode === "direct" ? await runDirect(scenario) : await runPlaywright(scenario);
    } catch (error) {
      rows.push({
        scenario,
        error: String(error?.message ?? error),
        data: { gpu: false, adapter: false, info: null },
        stderr: [],
        ms: Date.now() - started,
      });
      continue;
    }
    rows.push({ scenario, ...result, ms: Date.now() - started });
  }

  const results = rows.map((row) => {
    const info = row.data.info;
    return {
      id: row.scenario.id,
      combo: row.scenario.combo,
      mode: row.scenario.mode,
      flags: row.scenario.args.join(" "),
      env: row.scenario.env ?? {},
      navigatorGpu: Boolean(row.data.gpu),
      adapter: Boolean(row.data.adapter),
      vendor: info?.vendor || "",
      architecture: info?.architecture || "",
      device: info?.device || info?.description || "",
      hardware: Boolean(row.data.adapter) && !isSwiftShader(info),
      webgl: row.data.webgl ?? "",
      gl: shortGl(row.system),
      deviceCreated: Boolean(row.data.device),
      maxBufferSize: row.data.limits?.maxBufferSize ?? null,
      ms: row.ms,
      error: row.error ?? row.data.requestError ?? row.data.deviceError ?? null,
      stderr: [...new Set(row.stderr ?? [])].slice(0, 6),
      command:
        row.command ??
        `${CHROME} ${["--enable-logging=stderr", ...row.scenario.args].join(" ")}  # + Playwright defaults`,
    };
  });
  results.sort((a, b) => a.id - b.id);

  if (wantJson) {
    console.log(JSON.stringify({ url: TARGET_URL, chrome: CHROME, results }, null, 2));
    fs.rmSync(PROFILE_ROOT, { recursive: true, force: true });
    return;
  }

  const version = rows.find((r) => r.version)?.version ?? "unknown";
  console.log(`\nICE WebGPU hardware probe\n  chrome : ${CHROME} (${version})`);
  console.log(`  target : ${TARGET_URL}\n`);

  const header = ["#", "mode", "combo", "gpu", "adapter", "vendor", "arch", "gl", "verdict"];
  console.log(
    [
      pad(header[0], 3),
      pad(header[1], 7),
      pad(header[2], 19),
      pad(header[3], 4),
      pad(header[4], 8),
      pad(header[5], 8),
      pad(header[6], 12),
      pad(header[7], 7),
      header[8],
    ].join("  "),
  );
  console.log("-".repeat(92));
  for (const r of results) {
    const verdict = r.error
      ? "error"
      : !r.adapter
        ? "no-adapter"
        : r.hardware
          ? "HARDWARE"
          : "swiftshader";
    console.log(
      [
        pad(r.id, 3),
        pad(r.mode, 7),
        pad(r.combo, 19),
        pad(r.navigatorGpu ? "yes" : "no", 4),
        pad(r.adapter ? "yes" : "no", 8),
        pad(r.vendor || "-", 8),
        pad(r.architecture || "-", 12),
        pad(r.gl, 7),
        verdict,
      ].join("  "),
    );
  }

  console.log("\ndetails:");
  for (const r of results) {
    const bits = [
      `#${r.id} ${r.combo}: ${r.ms}ms`,
      r.device ? `adapter=${r.device}` : null,
      r.maxBufferSize ? `maxBufferSize=${(r.maxBufferSize / 2 ** 20).toFixed(0)}MiB` : null,
      r.deviceCreated ? "device=ok" : r.adapter ? "device=failed" : null,
      Object.entries(r.env).length
        ? `env ${Object.entries(r.env)
            .map(([k, v]) => `${k}=${v}`)
            .join(" ")}`
        : null,
      r.error ? `error=${r.error}` : null,
    ].filter(Boolean);
    console.log(`  ${bits.join(" | ")}`);
    for (const line of r.stderr) console.log(`      stderr: ${line}`);
  }

  // Prefer the hardware result with the shortest flag string: the launcher only
  // needs the switches that actually matter.
  const winner = results
    .filter((r) => r.hardware)
    .sort((a, b) => a.flags.length - b.flags.length)[0];
  console.log("");
  if (winner) {
    const launchFlags = winner.flags.split(/\s+/).filter(Boolean);
    console.log(
      `RECOMMENDATION: hardware WebGPU possible — combo #${winner.id} (${winner.combo}) reports ${winner.vendor}/${winner.architecture}${
        winner.maxBufferSize
          ? ` with maxBufferSize=${(winner.maxBufferSize / 2 ** 20).toFixed(0)}MiB`
          : ""
      }.`,
    );
    console.log(`  flags  : ${launchFlags.join(" ")}`);
    console.log(`  command: ${CHROME} ${launchFlags.join(" ")} ${TARGET_URL}`);
    const angle = results.find(
      (r) => r.hardware && /--use-angle=vulkan/.test(r.flags) && r.gl === "nvidia",
    );
    console.log(
      `  note   : ${
        angle
          ? `add --use-angle=vulkan to put WebGL/compositing on ${angle.gl} too (combo #${angle.id}); `
          : ""
      }--use-vulkan=native, --ozone-platform=x11, --disable-gpu-sandbox and VK_ICD_FILENAMES are not required.`,
    );
    console.log(`  probe  : ${winner.command}`);
  } else {
    const vk = results
      .flatMap((r) => r.stderr)
      .filter((l) => /vkCreateInstance|Vulkan|dawn/i.test(l));
    console.log("RECOMMENDATION: SwiftShader only — no combo exposed a hardware adapter.");
    console.log(
      vk.length
        ? `  blocker: ${[...new Set(vk)].slice(0, 3).join(" / ")}`
        : "  blocker: GPU process never reports a Vulkan device; WebGPU falls back to SwiftShader.",
    );
    console.log(
      "  use --enable-unsafe-webgpu alone for correctness; do not change the app to work around the driver.",
    );
  }
  console.log("");
  fs.rmSync(PROFILE_ROOT, { recursive: true, force: true });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
