import type { Meta, StoryObj } from "@storybook/react-vite";
import { IceSurfaceFallback } from "./IceSurface";

/**
 * The live desk cannot be a story: it needs a real WebGPU adapter, and the
 * story runner's headless Chromium has none. The story therefore renders the
 * fallback, which is the state most readers will see, and mirrors the copy the
 * surface shows when `navigator.gpu` or its adapter is missing.
 */
const meta = {
  title: "Canvas/ICE spike",
  component: IceSurfaceFallback,
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "`?canvas=ice` mounts a private, in-memory ICE desk. It is experimental and " +
          "never reads or writes Suite's graph; the default canvas and `?canvas=scene` " +
          "remain the only real surfaces (ADR-0032).",
      },
    },
  },
  args: {
    title: "This browser has no WebGPU",
    message:
      "ICE is an experimental WebGPU engine, so the desk cannot start here. The default canvas and the scene projection are unaffected.",
    detail:
      "navigator.gpu is not exposed by this browser. Try Chrome 113+, Edge 113+, or Safari 26+ with hardware acceleration on.",
    sceneHref: "/?canvas=scene",
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

export const BootFailure: Story = {
  args: {
    title: "ICE could not start",
    message: "The desk failed before it could draw. Nothing was written to your workspace.",
    detail: "device lost",
  },
};
