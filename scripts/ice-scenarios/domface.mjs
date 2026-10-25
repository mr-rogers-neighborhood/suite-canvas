/**
 * The DOM face scenario: `?face=dom` at readable zoom.
 *
 * ADR-0044 leaves one question open — whether the desk can carry the things a
 * knowledge canvas needs (rich text, a card a screen reader and a Tab key can
 * reach) without leaving the renderer. The sheet is a raster, so it cannot. The
 * DOM twin can, and it is mounted only for cards past the sheet's sharp ceiling,
 * which is exactly the cards a reader is looking at.
 *
 * This measures the claim rather than asserting it: the cards below the gate
 * mount nothing, the cards above it mount the real card with real text, and the
 * desk still holds its frame rate while they do.
 */
const READABLE = 420;

const mounted = (page) =>
  page.evaluate(() => {
    const cards = [...document.querySelectorAll(".suite-card-overlay__slot .node-card")];
    return cards.map((card) => {
      let hidden = false;
      let node = card;
      while (node) {
        if (node.getAttribute?.("aria-hidden") === "true") hidden = true;
        node = node.parentElement;
      }
      return {
        text: (card.innerText ?? "").trim().slice(0, 120),
        tabbable: card.querySelectorAll("[tabindex], a, button, [contenteditable]").length,
        hidden,
      };
    });
  });

const measureFps = (page, ms) =>
  page.evaluate(
    (duration) =>
      new Promise((resolve) => {
        let frames = 0;
        const started = performance.now();
        const tick = () => {
          frames += 1;
          if (performance.now() - started < duration) requestAnimationFrame(tick);
          else resolve(Math.round((frames * 1000) / (performance.now() - started)));
        };
        requestAnimationFrame(tick);
      }),
    ms,
  );

export default {
  url: "?fresh=1&face=dom",
  steps: [
    "wait:engine: ready",
    { wait: 2500, label: "settle" },
    { fit: true, screenshot: "fit" },
    { clickTestId: Array(10).fill("canvas-zoom-in"), label: "zoom-in" },
    { wait: 600 },
    {
      expect: (state) => {
        // The camera is past the sharp ceiling, so cards are wider on screen
        // than the gate: the sheet alone would be a blur here.
        const widest = Math.max(
          ...state.slots.map((slot) => Math.round(slot.world.width * state.camera.zoom)),
        );
        return widest >= READABLE;
      },
      why: "the camera is past the sharp ceiling",
    },
    {
      expect: async (_state, { page, memory }) => {
        memory.cards = await mounted(page);
        return memory.cards.length > 0;
      },
      why: "a readable card mounts the real DOM card",
    },
    {
      expect: (_state, { memory }) => memory.cards.every((card) => card.text.length > 0),
      why: "the mounted card carries its text, not an empty twin",
    },
    {
      expect: (_state, { memory }) => memory.cards.some((card) => card.tabbable > 0),
      why: "the mounted card is reachable with a keyboard",
    },
    {
      expect: (_state, { memory }) => memory.cards.every((card) => !card.hidden),
      why: "the mounted card is not hidden from the accessibility tree",
    },
    {
      expect: async (_state, { page, memory }) => {
        memory.fps = await measureFps(page, 2000);
        // The desk's own HUD is the reference: an absolute floor would fail on a
        // software adapter, and the question is whether the DOM cards cost
        // frames, not whether this machine is fast.
        memory.hud = await page.evaluate(() => {
          const text = document.body.innerText;
          const match = /fps: (\d+)/.exec(text);
          return match === null ? null : Number(match[1]);
        });
        const reference = memory.hud ?? 60;
        return memory.fps >= Math.min(45, reference * 0.75);
      },
      why: "the desk holds its frame rate while the DOM cards are mounted",
      timeout: 8000,
    },
    { screenshot: "readable" },
  ],
};
