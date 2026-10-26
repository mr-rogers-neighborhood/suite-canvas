/**
 * The dashboard's section tabs and local filter. Plain DOM and no framework:
 * every row is already rendered, so switching a tab is toggling `hidden`.
 */
const root = document.querySelector<HTMLElement>("[data-dashboard-tabs]");

if (root !== null) {
  const tabs = [...root.querySelectorAll<HTMLButtonElement>("[data-dashboard-tab]")];
  const rows = [...root.querySelectorAll<HTMLElement>("[data-dashboard-row]")];
  const filter = root.querySelector<HTMLInputElement>("[data-dashboard-filter]");
  const empty = root.querySelector<HTMLElement>("[data-dashboard-empty]");

  let section = tabs[0]?.dataset.dashboardTab ?? "";

  const apply = () => {
    const needle = (filter?.value ?? "").trim().toLowerCase();
    let visible = 0;
    for (const row of rows) {
      const matches =
        row.dataset.section === section &&
        (needle === "" || (row.dataset.search ?? "").includes(needle));
      row.hidden = !matches;
      if (matches) visible += 1;
    }
    if (empty !== null) empty.hidden = visible > 0;
  };

  for (const tab of tabs) {
    tab.addEventListener("click", () => {
      section = tab.dataset.dashboardTab ?? "";
      for (const other of tabs) {
        other.setAttribute("aria-selected", other === tab ? "true" : "false");
      }
      apply();
    });
  }

  filter?.addEventListener("input", apply);
  apply();
}
