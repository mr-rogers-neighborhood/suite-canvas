import { type CommandContext, paletteInvocations } from "./commandRegistry";
import type { PaletteItem } from "./paletteRank";

/**
 * The palette's contents, projected from the command registry.
 *
 * Nothing here decides *what* exists or whether it may run: `commandsFor` owns
 * availability and the registry owns the labels, so a row that disappears is a
 * registry change and not a branch in a provider. This module only decides how
 * a command reads as a row.
 */
export function buildPaletteItems(context: CommandContext): PaletteItem[] {
  return paletteInvocations(context).map((invocation) => ({
    id: invocation.id,
    commandId: invocation.commandId,
    title: invocation.label,
    group: invocation.group,
    weight: invocation.weight,
    keywords: invocation.keywords,
    run: invocation.run,
    ...(invocation.subtitle ? { subtitle: invocation.subtitle } : {}),
    ...(invocation.shortcut ? { shortcut: invocation.shortcut } : {}),
  }));
}
