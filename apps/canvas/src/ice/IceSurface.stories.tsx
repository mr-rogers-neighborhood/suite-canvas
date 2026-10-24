import type { Meta, StoryObj } from "@storybook/react-vite";
import { IceSurfaceFallback } from "./IceSurface";

const WEBGPU_HINT =
  "ICE is an experimental WebGPU engine, so the desk cannot start here. Run `pnpm dev:ice` " +
  "and open the printed URL in a headed Chrome started with `--enable-unsafe-webgpu` " +
  "(`node scripts/ice-chrome.mjs` does both for you). The integrated browser and headless " +
  "Chrome will not work. The default canvas and the scene projection are unaffected.";

/**
 * The live desk cannot be a story: it needs a real WebGPU adapter, and the
 * story runner's headless Chromium has none. The stories therefore render the
 * fallback, which is the state most readers will see, and mirror the copy the
 * surface shows when `navigator.gpu`, its adapter or its device is missing.
 */
const meta = {
  title: "Canvas/ICE demo",
  component: IceSurfaceFallback,
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "`?canvas=ice` mounts a private, in-memory ICE desk. Its Native demo is seeded with " +
          "notes, mini mats, a whiteboard and a notebook; its Suite demo (`?demo=suite`) projects " +
          "the example graph's boards and cards into the same native kinds, one way and read-only. " +
          "It is experimental and never reads or writes Suite's graph; the default canvas and " +
          "`?canvas=scene` remain the only real surfaces (ADR-0032).",
      },
    },
  },
  args: {
    title: "This browser has no WebGPU",
    message: WEBGPU_HINT,
    detail:
      "navigator.gpu is not exposed by this browser. Try Chrome 113+, Edge 113+, or Safari 26+ with hardware acceleration on.",
  },
  decorators: [
    (Story) => (
      <div className="ice-surface" style={{ position: "relative", height: "100vh" }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof IceSurfaceFallback>;

export default meta;
type Story = StoryObj<typeof meta>;

export const NoWebGpu: Story = {};

export const NoAdapter: Story = {
  args: {
    title: "WebGPU has no graphics adapter",
    detail:
      "requestAdapter() returned no adapter. Check that hardware acceleration is on and a supported GPU is present.",
  },
};

export const DeviceLost: Story = {
  args: {
    title: "The graphics device was lost",
    message:
      "ICE stopped drawing because the graphics device went away. Nothing was written to your workspace. Reset demo rebuilds the desk.",
    detail: "device lost",
  },
};

export const BootFailure: Story = {
  args: {
    title: "ICE could not start",
    message:
      "The desk failed before it could draw. Nothing was written to your workspace. Reset demo retries; if it keeps failing, run `pnpm dev:ice` in a headed Chrome with `--enable-unsafe-webgpu` (`node scripts/ice-chrome.mjs`).",
    detail: "the engine refused to boot",
  },
};
