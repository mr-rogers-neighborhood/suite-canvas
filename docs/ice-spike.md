# The ICE spike: operator guide

`?canvas=ice` mounts an experimental, in-memory `@vibecook/ice` desk. It is a rendering spike,
not a Suite surface: it reads and writes no workspace, share or presence data, and the React Flow
scene remains the default surface and the only document truth. The decision record is
[ADR-0032](./decisions/0032-ice-engine-deferral.md); the scene contract it is measured against is
[ADR-0033](./decisions/0033-interactive-scene-surface.md).

## Diagnosis: the machine is capable, the launch mode is the blocker

The reference machine is Arch Linux with an Intel UHD iGPU, an NVIDIA RTX 3080 Laptop GPU,
Vulkan 1.4 and Chrome 155 (`google-chrome-stable`). Measured behaviour:

- `navigator.gpu` exists on `http://localhost`, but Chrome started with its default flags returns
  **no adapter at all**. The desk shows the fallback card: `engine: no adapter`.
- A **headed** Chrome started with `--enable-unsafe-webgpu --enable-features=Vulkan` returns the
  **NVIDIA hardware adapter** (`nvidia / ampere`). Adding `--use-angle=vulkan` also moves
  compositing and WebGL onto the NVIDIA GPU.
- The VS Code integrated browser hands out no adapter, and **headless** Chrome has no compositor
  to put a Vulkan device behind, so it falls back to software. Both show the fallback card by
  design; neither is an app bug.
- `--enable-unsafe-swiftshader` is kept as a last-resort fallback flag. Software rendering proves
  correctness only; it is not a performance measurement.

`node scripts/ice-chrome.mjs --probe` prints the adapter table that produced those conclusions.
On this machine it reported ten flag combinations; the relevant rows are:

| Flags | Adapter | Device |
| --- | --- | --- |
| `--enable-unsafe-webgpu` | `google / swiftshader` | software, 1024 MiB max buffer |
| `--enable-unsafe-webgpu --enable-features=Vulkan` | `nvidia / ampere` | hardware, 4096 MiB max buffer |
| the same plus `--use-angle=vulkan` | `nvidia / ampere` | hardware, 4096 MiB max buffer |

`--ignore-gpu-blocklist`, `VK_ICD_FILENAMES`, `--disable-gpu-sandbox` and `--ozone-platform=x11`
were **not** required. `--ozone-platform=wayland` with Vulkan is explicitly incompatible in this
Chrome build, so do not add it.

## Launching

```sh
pnpm dev:ice
```

The launcher (`scripts/ice-chrome.mjs`) does four things:

1. Reuses a dev server already answering on `SUITE_DEV_URL` (default `http://localhost:5173`).
   If none answers, it starts `pnpm --filter @suite/canvas dev` and waits up to 30 s. A server it
   started keeps running after the command exits; a reused one is never stopped.
2. Opens a **headed** Chrome with a dedicated profile at `.ice-chrome-profile/` (gitignored), so
   the automation flags cannot leak into the browser you use for everything else.
3. Passes `--enable-unsafe-webgpu --enable-features=Vulkan --use-angle=vulkan
   --enable-unsafe-swiftshader`, plus the backgrounding flags that stop Chrome
   from recycling an occluded window's GPU device.
4. Opens a fresh workspace with the ICE surface mounted:

   ```text
   http://localhost:5173/?workspace=suite-ice-<timestamp>&fresh=1&canvas=ice#owner=<uuid>
   ```

   Every launch uses a new workspace id, so you never have to clear state to get the demo back.

Useful knobs:

| Variable | Meaning |
| --- | --- |
| `SUITE_CHROME` | Chrome binary. Default: `google-chrome-stable`, `google-chrome`, then `chromium` on `PATH`. |
| `SUITE_DEV_URL` | Dev server to open. Set it when Vite picked another port. |
| `SUITE_ICE_CHROME_ARGS` | Extra Chrome flags, space-separated. |
| `SUITE_ICE_PROBE_HEADLESS` | `1` runs `--probe` without a window. It reports SwiftShader by construction, so use it for quiet checks only. |

`node scripts/ice-chrome.mjs --probe` starts Chrome, reads the adapter and exits without opening
the desk. `--help` documents the same surface.

## Reading the HUD

The badge in the corner is the diagnostic surface:

- **`engine: …`** — `checking` and `loading` are the boot path; `ready` means the desk layer is
  drawing; `degraded` means it draws but reported a problem; `no WebGPU` and `no adapter` are the
  fallback; `failed` and `device lost` are terminal until you reset.
- **`seeded: 10/10 objects seeded`** — the seeded count against the expected total. Seed failures
  appear next to it as red text and in full in **Copy diagnostics**.
- **`adapter: hardware · nvidia / ampere / …`** — `hardware` or `software` is derived from
  `isFallback` and from names such as SwiftShader, llvmpipe or "Basic Render". A `software` adapter
  is fine for checking that the demo seeds and draws; do not read FPS on it as a benchmark.
- **`fps: …`** — a once-per-second rAF sample (frames per second in the headed window). It is a
  liveness signal, not a measured budget.
- **Reset demo** — disposes the document, engine and device, then reseeds. The one-time engine
  import and adapter acquisition are not repeated.
- **Copy diagnostics** — copies phase, engine state, adapter detail, seeded kinds, FPS and seed
  failures to the clipboard as plain text. Paste that into a bug report before describing symptoms.

## What works

The seeded desk has ten objects: six notes (four loose, one inside each mini mat), two mini mats,
a whiteboard and a notebook.

- Nested containers at depth two: a note with `parent` inside the Research/Reference mini mat moves
  with its mat, and the mat becomes a chip at far LOD.
- Pan by dragging the bare mat, wheel zoom about the pointer, and zoom-through into a mini mat.
- Selection: click, marquee, and shift-click to add. Drag a note to move it.
- Undo and redo through ICE's own history (`Ctrl/Cmd+Z`, `Shift+Ctrl/Cmd+Z`). This history is the
  ICE document's, not Suite's.
- Whiteboard ink (the demo seeds an empty board, so draw on it), notebook cover/ruling, light desk
  theme, and the fallback cards for every adapter state.
- Per-object isolation: one object type that refuses to spawn is reported in the seed failures and
  the rest of the desk still draws.

## What is intentionally absent

- **Suite data.** No workspace, graph, session, share or presence reads or writes. Nothing on this
  surface can change a Suite document.
- **Loro writes.** The desk is a private in-memory ICE document. Nothing is persisted; leaving the
  route disposes the document, the engine and the device.
- **Fonts.** The app does not host Caveat/Kalam and the spike must not fetch a third-party font, so
  notes show their paper, ink strokes and layout, not lettered glyphs.
- **Suite cards and the rest of the projection.** Tiptap editors, typed fields, tags, permissions,
  portal projection, edges, sections and share redaction are not ported.

The open questions that would make ICE an engine candidate are gates 1–7 in ADR-0032; this guide
does not claim any of them.

## Known failure modes

1. **Fallback card with `engine: no adapter`.** The window is not a headed Chrome with the Vulkan
   feature, or it is the integrated browser. Run `pnpm dev:ice` and use the printed URL.
2. **`engine: device lost`.** Some configurations lose the WebGPU device under load, most often
   SwiftShader and headless or virtual displays, and a backgrounded or occluded window makes it
   more likely. ICE stops drawing rather than showing a stale frame, and nothing was written
   anywhere. Recover with a hardware adapter (the Vulkan launch above, which also keeps the window
   from being backgrounded), then press **Reset demo**. If it recurs on hardware, copy the
   diagnostics and attach them to the issue; the HUD reports the loss reason.
3. **`engine: failed` with a detail line.** **Reset demo** retries the boot. A persistent failure
   is usually a Chrome build without the required WebGPU feature; use the launcher before filing.
4. **A seed failure line.** One object kind was refused (for example an unsupported whiteboard
   option). The remaining nine objects still draw; the failure names the kind and the error.

## Verification and the gated end-to-end test

The desk is covered in jsdom by `apps/canvas/src/ice/IceSurface.test.tsx` (mocked ICE) and by a
fallback-only story in Storybook. The live desk needs a real adapter, so its end-to-end test is
opt-in and never part of the default run:

```sh
SUITE_ICE_E2E=1 pnpm --filter @suite/e2e e2e ice.spec.ts
```

That spec launches the system Chrome **headed** with the flags above, opens a fresh
`?canvas=ice` workspace, waits for `engine: ready` and `10/10 objects seeded`, asserts the desk
canvas exists, and writes a screenshot only when it fails (under `e2e/test-results/`, so no
baseline PNG is committed). Without `SUITE_ICE_E2E` the file skips, and the default
`pnpm e2e` run still needs no GPU. See [testing.md](./testing.md) for the rest of the e2e commands.

## Manual checklist

- [ ] HUD reads `engine: ready`, `seeded: 10/10 objects seeded`, and an `adapter: hardware` line.
- [ ] Wheel zooms about the pointer; dragging the bare mat pans.
- [ ] Click, marquee and shift-click select notes; dragging a selected note moves it.
- [ ] Zoom into a mini mat and back out; the mat turns into a chip at far LOD.
- [ ] Draw on the whiteboard; open the notebook.
- [ ] `Ctrl/Cmd+Z` undoes the last move or stroke; `Shift+Ctrl/Cmd+Z` redoes it.
- [ ] **Reset demo** rebuilds the desk; **Copy diagnostics** reports `phase: ready`.
- [ ] Resize the window and confirm the desk repaints instead of stretching.
