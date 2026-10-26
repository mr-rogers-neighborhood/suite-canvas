import defaultMdxComponents from "fumadocs-ui/mdx";

type Components = Partial<typeof defaultMdxComponents>;

/** Markdown elements styled by Fumadocs UI, plus per-page overrides. */
export function getMDXComponents(components?: Components): Components {
  return {
    ...defaultMdxComponents,
    ...components,
  };
}
