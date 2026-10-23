import type { Meta, StoryObj } from "@storybook/react-vite";
import { AttachmentFrame, PENDING_UPLOAD_NOTICE } from "./AttachmentView";

/** A drawn picture, so the story needs neither IndexedDB nor a relay. */
const SKETCH = `data:image/svg+xml;utf8,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180" viewBox="0 0 320 180">
     <rect width="320" height="180" fill="#eef2f7"/>
     <rect x="28" y="36" width="110" height="108" rx="8" fill="#c7d7ea"/>
     <rect x="182" y="36" width="110" height="108" rx="8" fill="#c7d7ea"/>
     <path d="M138 90H182" stroke="#5b7fa6" stroke-width="5" stroke-dasharray="8 6"/>
     <text x="160" y="168" font-family="system-ui, sans-serif" font-size="12"
       fill="#41566e" text-anchor="middle">pasted image</text>
   </svg>`,
)}`;

/**
 * The node view's drawing: the image plus, when the bytes have not reached a
 * relay, one quiet line that says who cannot see it. `PendingUpload` is the
 * state a failed relay upload leaves behind; it must read as a fact, not an
 * error — the author keeps their image and learns what a collaborator sees.
 */
const meta = {
  title: "Editor/Attachment",
  component: AttachmentFrame,
  args: {
    known: true,
    src: SKETCH,
    failed: false,
    pending: false,
    label: "Screenshot of the relay dashboard",
    width: 320,
    height: 180,
  },
  decorators: [
    (Story) => (
      <div className="max-w-md p-4">
        <p className="m-0">
          A note with an image <Story />
        </p>
      </div>
    ),
  ],
  tags: ["autodocs"],
} satisfies Meta<typeof AttachmentFrame>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Synced: Story = {};

export const PendingUpload: Story = {
  args: { pending: true },
  parameters: {
    docs: {
      description: {
        story: PENDING_UPLOAD_NOTICE,
      },
    },
  },
};
