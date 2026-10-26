import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared";
import { site } from "@/lib/shared";

/** Shared chrome for the docs layout: title, GitHub link and agent endpoints. */
export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: site.name,
      url: "/docs",
    },
    githubUrl: site.githubUrl,
    links: [
      { text: "llms.txt", url: "/llms.txt", active: "none" },
      { text: "llms-full.txt", url: "/llms-full.txt", active: "none" },
    ],
  };
}
