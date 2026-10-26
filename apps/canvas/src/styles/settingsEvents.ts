/** A window event: the palette and the theme menu both open the same screen. */
export const SETTINGS_EVENT = "suite:settings-open";

/** Opens Settings from anywhere that is not already inside the dialog. */
export function openSettings(): void {
  window.dispatchEvent(new Event(SETTINGS_EVENT));
}
