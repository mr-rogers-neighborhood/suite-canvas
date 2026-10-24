#!/usr/bin/env node
/**
 * The ICE lab: run a scenario against the real canvas and keep the evidence.
 *
 * The desk is GPU-drawn, so a DOM assertion cannot answer "is that dot on the
 * card?" and a screenshot cannot answer "where is it?". This runner does both:
 * every step may take a picture and write the surface's own state (published by
 * `iceDebug.ts` at `window.__suiteIce`), and a scenario asserts on that state.
 *
 * Steps are plain objects, so a scenario reads like the gesture it describes:
 *
 *   export default {
 *     url: "?workspace=lab-links&fresh=1",
 *     steps: [
 *       "wait:engine: ready",
 *       { fit: true, screenshot: "fit" },
 *       { hoverCard: 0, screenshot: "hover" },
 *       { expect: (s) => s.overlays.connectorDots.length === 4, why: "four dots" },
 *     ],
 *   };
 *
 * Run it through the virtual display so Chrome gets the hardware adapter and no
 * window appears (`SUITE_ICE_VISIBLE=1` makes it watchable):
 *
 *   pnpm ice:lab links
 *   pnpm ice:lab links --visible
 *   pnpm ice:lab links --two        # a second context in the same room
 */
import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const SCENARIO_DIR = join(root, "scripts", "ice-scenarios");
const ARTIFACTS = join(root, "e2e", "artifacts");
const DEV_URL = process.env.SUITE_DEV_URL ?? "http://localhost:5173";

/** CSS px a corner handle sits outside its frame's corner — the desk's chrome is screen-space. */
const HANDLE_PX = 6;

/** Mirrors `ICE_LAUNCH_OPTIONS` in `e2e/playwright.config.ts` (a TS file this runner cannot import). */
const CHROME_ARGS = [
  "--enable-unsafe-webgpu",
  "--enable-features=Vulkan",
  "--use-angle=vulkan",
  "--enable-unsafe-swiftshader",
  "--ozone-platform=x11",
];

const args = process.argv.slice(2);
const flags = new Set(args.filter((arg) => arg.startsWith("--")));
// Every plain argument is a scenario, so a gate can name the whole set in one
// run: `pnpm ice:lab camera editing links` stops at the first failure.
const names = args.filter((arg) => !arg.startsWith("--"));
const two = flags.has("--two");

function stamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

async function loadChromium() {
  const candidate = join(root, "e2e", "node_modules", "@playwright", "test", "index.mjs");
  try {
    return (await import(pathToFileURL(candidate).href)).chromium;
  } catch {
    return (await import("@playwright/test")).chromium;
  }
}

async function checkDevServer() {
  try {
    const response = await fetch(DEV_URL);
    if (!response.ok) throw new Error(String(response.status));
  } catch (error) {
    console.error(`The dev server is not answering at ${DEV_URL}: ${String(error)}`);
    console.error("Start it with `pnpm dev` (canvas + collab server) and try again.");
    process.exit(2);
  }
}

async function state(page) {
  return page.evaluate(() => window.__suiteIce ?? null);
}

async function waitForState(page, timeout = 30_000) {
  await page.waitForFunction(() => (window.__suiteIce?.slots?.length ?? 0) > 0, null, { timeout });
  return state(page);
}

function surfaceBox(page) {
  return page.locator(".ice-surface").boundingBox();
}

/** World units → client px, using the surface's own camera. */
function toClient(box, camera, point) {
  return {
    x: box.x + (point.x - camera.x) * camera.zoom,
    y: box.y + (point.y - camera.y) * camera.zoom,
  };
}

/**
 * Hover something and let the desk agree. The surface samples the pointer on a
 * frame and rate-limits it, so a move that arrives inside the throttle window is
 * dropped; a second, 1px move after the window guarantees the last sample is the
 * one under the pointer.
 */
async function settleHover(page, point) {
  await page.mouse.move(point.x, point.y, { steps: 4 });
  await page.waitForTimeout(120);
  await page.mouse.move(point.x + 1, point.y + 1);
  await page.waitForTimeout(250);
}

/**
 * A drag the desk can actually follow: the pointer must rest on its last sample
 * before the release, or the engine applies the move it processed one step
 * earlier and the gesture ends short of where it was released.
 */
async function release(page, at) {
  await page.mouse.move(at.x, at.y);
  await page.waitForTimeout(80);
  await page.mouse.up();
  await page.waitForTimeout(400);
}

/**
 * Where a card is, in the coordinates the camera currently speaks. On the plane
 * that is its world box; inside a Board the camera is in that frame's units, so
 * it is the card's own `local` box.
 */
function cardRect(state, card) {
  return state.entered.length > 0 ? card.local : card.world;
}

function centre(rect) {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

/** The one-line version of the surface state, for the report. */
function summarize(current) {
  if (current === null) return null;
  return {
    camera: current.camera,
    entered: current.entered.map((frame) => frame.name),
    cards: current.slots.length,
    boards: current.boards.length,
    dots: current.overlays.connectorDots.length,
    cursors: current.overlays.cursors.length,
    edges: current.edges.length,
    selection: current.selection,
    peers: current.peers.length,
  };
}

function slotOf(current, key) {
  if (key === undefined) return current.slots[0];
  if (typeof key === "number") return current.slots[key];
  return current.slots.find((slot) => slot.cardId === key);
}

function boardOf(current, key) {
  if (key === undefined) return current.boards[0];
  if (typeof key === "number") return current.boards[key];
  return current.boards.find((board) => board.id === key || board.name === key);
}

/** Add `workspace=<id>` to a scenario URL, keeping any other parameters it carries. */
function labUrl(search, workspace) {
  const query = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  if (!query.has("workspace")) query.set("workspace", workspace);
  return `${DEV_URL}/?${query.toString()}`;
}

async function runScenario(name) {
  await checkDevServer();
  const scenarioPath = join(SCENARIO_DIR, `${name}.mjs`);
  const scenario = (await import(pathToFileURL(scenarioPath).href)).default;
  const unique = scenario.workspace ?? `lab-${name}-${Date.now()}`;
  // A fresh browser context holds no owner key, so a workspace it has never
  // opened asks for one. Every run therefore gets its own workspace id unless the
  // scenario names one (a scenario that wants to reuse an `owner=` link can).
  const url = labUrl(scenario.url ?? "?fresh=1", unique);

  const runDir = join(ARTIFACTS, `${stamp()}-${name}`);
  mkdirSync(runDir, { recursive: true });

  const chromium = await loadChromium();
  const browser = await chromium.launch({
    channel: "chrome",
    headless: false,
    args: CHROME_ARGS,
  });

  const report = { scenario: name, url, startedAt: new Date().toISOString(), steps: [] };
  // What a step learned and a later step needs: the rect before a drag is the
  // only sensible reference for "did it move?", and hard-coding the seed's
  // numbers would make the scenario a copy of the demo rather than a test.
  const memory = {};
  let failure = null;
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    page.on("pageerror", (error) => {
      report.steps.push({ step: "pageerror", error: String(error).slice(0, 400) });
    });
    await page.goto(url);
    await waitForState(page);

    let index = 0;
    for (const raw of scenario.steps ?? []) {
      const step = typeof raw === "string" ? stepFromString(raw) : raw;
      index += 1;
      const label = step.label ?? step.screenshot ?? String(index);
      const box = await surfaceBox(page);
      const current = await state(page);

      if (step.wait !== undefined) await page.waitForTimeout(step.wait);
      if (step.waitFor !== undefined) {
        await page.waitForFunction((text) => document.body.innerText.includes(text), step.waitFor, {
          timeout: 90_000,
        });
      }
      if (step.fit === true) {
        await page.getByTestId("canvas-zoom-fit").click();
        await page.waitForTimeout(400);
      }
      if (step.clickTestId !== undefined) {
        // A shell control is DOM, not desk: the Dock's new-Board item lives in
        // its "+ New card" menu, so a step may name the clicks in order.
        const targets = Array.isArray(step.clickTestId) ? step.clickTestId : [step.clickTestId];
        for (const testId of targets) {
          await page.getByTestId(testId).click();
          await page.waitForTimeout(250);
        }
        report.steps.push({ step: label, clickedTestIds: targets });
      }
      if (step.clickCard !== undefined) {
        // A bare press selects; shift extends the selection, which is how a
        // multi-card drag is reached without a marquee.
        const card = slotOf(current, step.clickCard.card ?? step.clickCard);
        if (card === undefined) throw new Error(`no card ${String(step.clickCard)}`);
        const point = toClient(box, current.camera, centre(cardRect(current, card)));
        await page.mouse.move(point.x, point.y, { steps: 3 });
        if (step.clickCard.shift === true) await page.keyboard.down("Shift");
        await page.mouse.click(point.x, point.y);
        if (step.clickCard.shift === true) await page.keyboard.up("Shift");
        await page.waitForTimeout(300);
        report.steps.push({ step: label, clicked: card.cardId, at: point });
      }
      if (step.dragCard !== undefined) {
        // A card drag in world units: the pointer must travel, or the controller
        // (rightly) writes nothing.
        const card = slotOf(current, step.dragCard.card);
        if (card === undefined) throw new Error(`no card ${step.dragCard.card}`);
        const rect = cardRect(current, card);
        const from = toClient(box, current.camera, centre(rect));
        const to = toClient(box, current.camera, {
          x: rect.x + rect.width / 2 + step.dragCard.dx,
          y: rect.y + rect.height / 2 + step.dragCard.dy,
        });
        await page.mouse.move(from.x, from.y, { steps: 3 });
        await page.mouse.down();
        await page.mouse.move(to.x, to.y, { steps: step.steps ?? 14 });
        await release(page, to);
        report.steps.push({ step: label, dragged: card.cardId, dx: step.dragCard.dx });
      }
      if (step.dragCardTo !== undefined) {
        // A drop onto a Board's face: the target is a point, so the drop lands
        // inside the frame rather than where the card used to be.
        const card = slotOf(current, step.dragCardTo.card);
        const board = boardOf(current, step.dragCardTo.board);
        if (card === undefined) throw new Error(`no card ${step.dragCardTo.card}`);
        if (board === undefined) throw new Error(`no board ${step.dragCardTo.board}`);
        const from = toClient(box, current.camera, centre(cardRect(current, card)));
        const to = toClient(box, current.camera, centre(board.world));
        await page.mouse.move(from.x, from.y, { steps: 3 });
        await page.mouse.down();
        await page.mouse.move(to.x, to.y, { steps: 18 });
        await release(page, to);
        report.steps.push({ step: label, dragged: card.cardId, into: board.id });
      }
      if (step.clickEdge !== undefined) {
        // A link is hit-tested against its ink, so the press goes on the middle
        // of the drawn line, not on its bounding box.
        const index = typeof step.clickEdge === "number" ? step.clickEdge : 0;
        const edge = current.edges[index];
        if (edge === undefined) throw new Error(`no edge ${String(step.clickEdge)}`);
        const mid = { x: (edge.from.x + edge.to.x) / 2, y: (edge.from.y + edge.to.y) / 2 };
        // The edge's box is world; on a frame plane that is what the camera sees.
        const point = toClient(box, current.camera, mid);
        await page.mouse.move(point.x, point.y, { steps: 3 });
        await page.mouse.click(point.x, point.y);
        await page.waitForTimeout(300);
        report.steps.push({ step: label, clickedEdge: edge.edgeId, at: point });
      }
      if (step.hover !== undefined) {
        await page.mouse.move(step.hover[0], step.hover[1], { steps: 4 });
        await page.waitForTimeout(250);
      }
      if (step.hoverCard !== undefined) {
        const slot = slotOf(current, step.hoverCard);
        if (slot === undefined) throw new Error(`no slot ${step.hoverCard}`);
        const point = toClient(box, current.camera, centre(slot.world));
        await settleHover(page, point);
        report.steps.push({ step: label, hovered: slot.cardId, at: point });
      }
      if (step.hoverBoard !== undefined) {
        const board = boardOf(current, step.hoverBoard);
        if (board === undefined) throw new Error(`no board ${step.hoverBoard}`);
        const point = toClient(box, current.camera, centre(board.world));
        await settleHover(page, point);
        report.steps.push({ step: label, hoveredBoard: board.id, at: point });
      }
      if (step.dblclickBoard !== undefined) {
        const board = boardOf(current, step.dblclickBoard);
        if (board === undefined) throw new Error(`no board ${step.dblclickBoard}`);
        const point = toClient(box, current.camera, centre(board.world));
        await page.mouse.dblclick(point.x, point.y);
        await page.waitForTimeout(600);
      }
      if (step.click !== undefined) {
        await page.mouse.click(step.click[0], step.click[1]);
        await page.waitForTimeout(200);
      }
      if (step.clickWorld !== undefined) {
        const current = await state(page);
        const point = toClient(box, current.camera, {
          x: step.clickWorld[0],
          y: step.clickWorld[1],
        });
        await page.mouse.click(point.x, point.y);
        await page.waitForTimeout(200);
      }
      if (step.reload === true) {
        // A reload is the only proof that a gesture reached the document: the
        // desk is rebuilt from Loro, so anything ICE alone knew is gone.
        await page.reload();
        await waitForState(page);
        await page.waitForTimeout(1500);
      }
      if (step.key !== undefined) {
        await page.keyboard.press(step.key);
        await page.waitForTimeout(200);
      }
      if (step.drag !== undefined) {
        const [[x1, y1], [x2, y2]] = step.drag;
        await page.mouse.move(x1, y1);
        await page.mouse.down();
        await page.mouse.move(x2, y2, { steps: step.steps ?? 12 });
        await release(page, { x: x2, y: y2 });
      }
      if (step.clickBoard !== undefined) {
        // A press on the frame's own strip selects it, so the desk draws its
        // handles; nothing moves when the pointer never travels.
        const board = boardOf(current, step.clickBoard);
        if (board === undefined) throw new Error(`no board ${step.clickBoard}`);
        const point = toClient(box, current.camera, {
          // A quarter along the strip: clear of the corner handles and of the
          // north wall's link dot, which is the middle of that edge.
          x: board.world.x + board.world.width * 0.25,
          y: board.world.y + 4,
        });
        await page.mouse.click(point.x, point.y);
        await page.waitForTimeout(300);
        report.steps.push({ step: label, selected: board.id });
      }
      if (step.linkFromBoard !== undefined) {
        // A frame offers its wall midpoints; the drag leaves one and lands on a
        // card's connector, which is what "link a Board to a card" means.
        const board = boardOf(current, step.linkFromBoard.board);
        const card = slotOf(current, step.linkFromBoard.toCard);
        if (board === undefined) throw new Error(`no board ${step.linkFromBoard.board}`);
        if (card === undefined) throw new Error(`no card ${step.linkFromBoard.toCard}`);
        const { world } = board;
        const wall = {
          east: { x: world.x + world.width, y: world.y + world.height / 2 },
          west: { x: world.x, y: world.y + world.height / 2 },
          north: { x: world.x + world.width / 2, y: world.y },
          south: { x: world.x + world.width / 2, y: world.y + world.height },
        }[step.linkFromBoard.side ?? "east"];
        // Rest *on* the frame first — the dots are offered for the object under
        // the pointer — then step the last two px out to the wall's dot.
        const inside = toClient(box, current.camera, {
          x: wall.x - (step.linkFromBoard.side === "west" ? -6 : 6),
          y: wall.y,
        });
        const from = toClient(box, current.camera, wall);
        const to = toClient(box, current.camera, centre(card.world));
        await page.mouse.move(inside.x, inside.y, { steps: 4 });
        await page.waitForTimeout(200);
        await page.mouse.move(from.x, from.y, { steps: 2 });
        await page.waitForTimeout(250);
        await page.mouse.down();
        await page.mouse.move(to.x, to.y, { steps: 16 });
        await release(page, to);
        report.steps.push({ step: label, linked: board.id, to: card.cardId, wall });
      }
      if (step.linkFromCard !== undefined) {
        // The other direction: a card's connector to a Board's wall.
        const card = slotOf(current, step.linkFromCard.card);
        const board = boardOf(current, step.linkFromCard.board);
        if (card === undefined) throw new Error(`no card ${step.linkFromCard.card}`);
        if (board === undefined) throw new Error(`no board ${step.linkFromCard.board}`);
        const { world } = board;
        const insideBoard = {
          x: world.x + world.width / 2,
          y: world.y + world.height / 2,
        };
        // A card's east connector is the middle of its right edge.
        const connector = {
          x: card.world.x + card.world.width,
          y: card.world.y + card.world.height / 2,
        };
        const from = toClient(box, current.camera, connector);
        const boardPoint = toClient(box, current.camera, insideBoard);
        await page.mouse.move(from.x - 6, from.y, { steps: 4 });
        await page.waitForTimeout(200);
        await page.mouse.move(from.x, from.y, { steps: 2 });
        await page.waitForTimeout(200);
        await page.mouse.down();
        await page.mouse.move(boardPoint.x, boardPoint.y, { steps: 16 });
        await release(page, boardPoint);
        report.steps.push({ step: label, fromCard: card.cardId, toBoard: board.id });
      }
      if (step.dragBoard !== undefined) {
        // A frame is grabbed where no card is: its own top strip, or a corner
        // handle once it is selected.
        const board = boardOf(current, step.dragBoard.board);
        if (board === undefined) throw new Error(`no board ${step.dragBoard.board}`);
        const { world } = board;
        const camera = current.camera;
        // A handle is drawn a few screen px outside the frame's corner (`MARKS.select.gap`)
        // and keeps its size at every zoom, so the press is placed in CSS px; the
        // frame's own strip is world-space, like the frame.
        const corner = toClient(box, camera, {
          x: world.x + world.width,
          y: world.y + world.height,
        });
        const start =
          step.dragBoard.from === "se"
            ? { x: corner.x + HANDLE_PX, y: corner.y + HANDLE_PX }
            : toClient(box, camera, { x: world.x + world.width * 0.25, y: world.y + 4 });
        const end = {
          x: start.x + step.dragBoard.dx * camera.zoom,
          y: start.y + step.dragBoard.dy * camera.zoom,
        };
        await page.mouse.move(start.x, start.y);
        await page.mouse.down();
        await page.mouse.move(end.x, end.y, { steps: step.steps ?? 12 });
        await release(page, end);
        report.steps.push({ step: label, dragged: board.id, start, dx: step.dragBoard.dx });
      }
      if (step.dragWorld !== undefined) {
        const current = await state(page);
        const [[ax, ay], [bx, by]] = step.dragWorld;
        const from = toClient(box, current.camera, { x: ax, y: ay });
        const to = toClient(box, current.camera, { x: bx, y: by });
        // The select tool pans the bare mat and draws its marquee on Shift
        // (`canvasDrag: "pan"`, `canvasDragShift: "marquee"`).
        if (step.shift === true) await page.keyboard.down("Shift");
        await page.mouse.move(from.x, from.y);
        await page.mouse.down();
        await page.mouse.move(to.x, to.y, { steps: step.steps ?? 12 });
        if (step.shift === true) await page.keyboard.up("Shift");
        await release(page, to);
      }

      let after = await state(page);
      if (step.expect !== undefined) {
        // The desk keeps painting after the gesture ends, so an expectation says
        // what should become true, not that it is true in this very frame.
        const deadline = Date.now() + (step.timeout ?? 3_000);
        let ok = await step.expect(after, { page, memory });
        while (!ok && Date.now() < deadline) {
          await page.waitForTimeout(100);
          after = await state(page);
          ok = await step.expect(after, { page, memory });
        }
        report.steps.push({
          step: label,
          expect: step.why ?? "expectation",
          ok,
          state: summarize(after),
        });
        if (!ok) throw new Error(`expectation failed at ${label}: ${step.why ?? "step"}`);
      }
      const shot = step.screenshot ?? step.label;
      if (shot !== undefined) {
        await page.screenshot({ path: join(runDir, `step-${index}-${shot}.png`) });
      }
      if (after !== null) {
        writeFileSync(join(runDir, `state-${index}-${label}.json`), JSON.stringify(after, null, 2));
      }
    }

    if (two) {
      const ownerUrl = page.url();
      const second = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      const peer = await second.newPage();
      await peer.goto(ownerUrl);
      await waitForState(peer);
      await peer.mouse.move(400, 400, { steps: 4 });
      await page.waitForTimeout(800);
      await page.screenshot({ path: join(runDir, "two-browsers.png") });
      const alice = await state(page);
      const bob = await state(peer);
      report.peers = { first: alice?.peers?.length ?? 0, second: bob?.peers?.length ?? 0 };
      await second.close();
    }
  } catch (error) {
    failure = error;
  } finally {
    writeFileSync(join(runDir, "report.json"), JSON.stringify(report, null, 2));
    await browser.close();
  }

  const latest = readdirSync(ARTIFACTS)
    .filter((entry) => entry.endsWith(`-${name}`))
    .sort()
    .at(-1);
  console.log(`\nscenario: ${name}`);
  console.log(`evidence: e2e/artifacts/${latest ?? runDir}`);
  if (failure !== null) {
    console.error(`FAILED: ${failure instanceof Error ? failure.message : String(failure)}`);
    process.exit(1);
  }
  if (report.peers !== undefined) console.log(`peers: ${JSON.stringify(report.peers)}`);
  console.log("ok");
}

async function run() {
  for (const name of names.length > 0 ? names : ["links"]) {
    await runScenario(name);
  }
}

/** `"wait:engine: ready"` → `{ waitFor: "engine: ready" }`, `"wait:800"` → `{ wait: 800 }`. */
function stepFromString(raw) {
  if (!raw.startsWith("wait:")) return { label: raw };
  const rest = raw.slice("wait:".length);
  return /^\d+$/.test(rest) ? { wait: Number(rest) } : { waitFor: rest };
}

await run();
