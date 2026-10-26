import type { ReactNode } from "react";

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2 border-t border-[var(--hairline)] px-3 py-3 first:border-t-0">
      <h2 className="text-[11px] font-semibold uppercase tracking-wide text-[var(--ink-muted)]">
        {title}
      </h2>
      {children}
    </section>
  );
}
