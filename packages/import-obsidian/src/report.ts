/**
 * Owns the fidelity summary an import returns. A silent drop is the failure this
 * type exists to prevent: every class of loss has a field, and the caller can
 * show the whole thing to the person who dropped the folder.
 */

export interface ImportReport {
  /** What the vault held, and what happened to each file. */
  files: {
    total: number;
    notes: number;
    canvases: number;
    attachments: number;
    skipped: number;
  };
  /** Records the import wrote. */
  records: {
    boards: number;
    cards: number;
    sections: number;
    tags: number;
    links: number;
  };
  /** Wikilinks: how many became mentions, and which did not. */
  links: {
    resolved: number;
    unresolved: string[];
    ambiguous: string[];
  };
  /** Frontmatter: how many keys became fields, and which stayed as text. */
  properties: {
    mapped: number;
    keptAsText: Array<{ path: string; key: string }>;
  };
  /** Canvas colours: how many found a slot, and which had none. */
  colours: {
    sections: number;
    cards: number;
    unmapped: string[];
  };
  /** Embedded files whose bytes were not imported. */
  attachments: Array<{ path: string; reason: string }>;
  /** Files the import did not read, each with the reason. */
  skipped: Array<{ path: string; reason: string }>;
  /** Anything else the reader should know, one sentence per line. */
  notes: string[];
  /** The boards the import wrote, so the caller can open one. */
  boards: Array<{ id: string; name: string }>;
}

export function newImportReport(): ImportReport {
  return {
    files: { total: 0, notes: 0, canvases: 0, attachments: 0, skipped: 0 },
    records: { boards: 0, cards: 0, sections: 0, tags: 0, links: 0 },
    links: { resolved: 0, unresolved: [], ambiguous: [] },
    properties: { mapped: 0, keptAsText: [] },
    colours: { sections: 0, cards: 0, unmapped: [] },
    attachments: [],
    skipped: [],
    notes: [],
    boards: [],
  };
}

/** One line for a toast: what arrived, and what did not. */
export function reportSummary(report: ImportReport): string {
  const boards = report.records.boards === 1 ? "board" : "boards";
  const cards = report.records.cards === 1 ? "card" : "cards";
  const parts = [`${report.records.cards} ${cards} in ${report.records.boards} ${boards}`];
  if (report.links.unresolved.length > 0) {
    parts.push(`${report.links.unresolved.length} unresolved link(s)`);
  }
  if (report.properties.keptAsText.length > 0) {
    parts.push(`${report.properties.keptAsText.length} property key(s) kept as text`);
  }
  if (report.files.skipped > 0) parts.push(`${report.files.skipped} file(s) skipped`);
  return parts.join("; ");
}

/** Why an import could not run at all. A single bad file is reported, not fatal. */
export interface ImportFailure {
  kind: "no-files" | "write-failed";
  message: string;
}
