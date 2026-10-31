import { type SerializedPageTree, useFumadocsLoader } from "fumadocs-core/source/client";
import type { TOCItemType } from "fumadocs-core/toc";
import { DocsLayout } from "fumadocs-ui/layouts/docs";
import { DocsDescription, DocsPage, DocsTitle } from "fumadocs-ui/layouts/docs/page";
import { baseOptions } from "../lib/layout.shared";
import { Provider, type ProviderProps } from "./provider";

export interface DocsProps extends ProviderProps {
  tree: SerializedPageTree;
  title: string;
  description?: string;
  toc: TOCItemType[];
}

/**
 * One page of one space, as a React island.
 *
 * `tree` is the sidebar of the space the page belongs to, so the developer pages and the handbook
 * are laid out identically and never show each other's navigation.
 */
export function Docs({ tree, title, description, toc, children, ...props }: DocsProps) {
  const data = useFumadocsLoader({ tree });

  return (
    <Provider {...props}>
      <DocsLayout {...baseOptions()} tree={data.tree}>
        <DocsPage toc={toc}>
          <DocsTitle>{title}</DocsTitle>
          <DocsDescription>{description ?? ""}</DocsDescription>
          {children}
        </DocsPage>
      </DocsLayout>
    </Provider>
  );
}
