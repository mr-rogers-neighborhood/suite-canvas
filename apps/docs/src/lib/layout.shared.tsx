import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared";

/** What both spaces share: the name, the repository, and the way back to the app. */
export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: "Suite",
      url: "/",
    },
    githubUrl: "https://github.com/mr-rogers-neighborhood/suite-canvas",
    links: [
      {
        text: "The app",
        url: "https://app.suite.run",
        external: true,
      },
    ],
  };
}
