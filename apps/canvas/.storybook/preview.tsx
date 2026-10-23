import type { Preview } from "@storybook/react-vite";
import "../src/styles/global.css";

const preview: Preview = {
  parameters: {
    // Every story runs as a test. A violation reported by the axe pass fails
    // that test, instead of waiting for someone to open the a11y panel.
    // Stories that predate this can opt out with `a11y: { test: "todo" }`.
    a11y: { test: "error" },
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
  },
};

export default preview;
