import { navigate } from "astro:transitions/client";
import { RootProvider } from "fumadocs-ui/provider/astro";
import type { ReactNode } from "react";
import SearchDialog from "./search";

export interface ProviderProps {
  /** `Astro.url.pathname` */
  pathname: string;
  /** `Astro.params` */
  params: Record<string, string | undefined>;
  children?: ReactNode;
}

/** The Fumadocs providers, once per page, with Astro's client router as the navigator. */
export function Provider({ pathname, params, children }: ProviderProps) {
  return (
    <RootProvider pathname={pathname} params={params} navigate={navigate} search={{ SearchDialog }}>
      {children}
    </RootProvider>
  );
}
