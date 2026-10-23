import type { Meta, StoryObj } from "@storybook/react-vite";
import { ImageLinkFrame } from "./ImageLinkView";

/** A drawn picture, so the loaded state needs no network at all. */
const SKETCH = `data:image/svg+xml;utf8,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="270" viewBox="0 0 480 270">
     <rect width="480" height="270" fill="#eef2f7"/>
     <rect x="40" y="60" width="150" height="150" rx="10" fill="#c7d7ea"/>
     <rect x="290" y="60" width="150" height="150" rx="10" fill="#c7d7ea"/>
     <path d="M190 135H290" stroke="#5b7fa6" stroke-width="6" stroke-dasharray="10 8"/>
     <text x="240" y="245" font-family="system-ui, sans-serif" font-size="18"
       fill="#41566e" text-anchor="middle">canvas → relay</text>
   </svg>`,
)}`;

/**
 * The body of the `image` node view: the picture when it loads, and the
 * placeholder that shows the URL when it does not. The broken state needs a
 * third party to fail, so `broken` pins it here — this story is the primary
 * view of a state the real app reaches only with a dead link.
 */
const meta = {
  title: "Editor/Image link",
  component: ImageLinkFrame,
  args: {
    src: SKETCH,
    alt: "Sketch of the canvas and the relay",
    width: null,
    height: null,
  },
  decorators: [
    (Story) => (
      <div className="image-link-node max-w-md p-4">
        <Story />
      </div>
    ),
  ],
  tags: ["autodocs"],
} satisfies Meta<typeof ImageLinkFrame>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Loaded: Story = {};

export const Broken: Story = {
  args: {
    src: "https://cdn.example.com/photos/relay-rack.png",
    alt: "Rack elevation",
    broken: true,
  },
};

export const RefusedScheme: Story = {
  args: { src: null, rawSrc: "javascript:alert(1)", alt: "" },
};
