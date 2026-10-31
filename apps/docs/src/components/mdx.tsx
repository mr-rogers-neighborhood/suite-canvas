import { DocsBody } from "fumadocs-ui/layouts/docs/page";
import defaultMdxComponents from "fumadocs-ui/mdx";
import type { MDXComponents } from "mdx/types";

/** The components every page's Markdown is rendered with. */
export function getMDXComponents(components?: MDXComponents) {
  return {
    ...defaultMdxComponents,
    ...components,
  } satisfies MDXComponents;
}

/** `wrapper` gives the content its prose styles when the integration renders a page. */
export default getMDXComponents({ wrapper: DocsBody });
