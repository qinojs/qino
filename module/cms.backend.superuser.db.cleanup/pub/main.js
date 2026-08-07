import { api } from "../../core/pub/js/qino.js";

cms.initNode("backend.superuser.db.cleanup", (el) => {
  const nid = Number(cms.el.nid(el));
  const search = el.querySelector("[data-table-search]");
  const dialogs = () => import("@qino/u2/js/dialog/dialog.js");
  const rows = () => [...el.querySelectorAll("tbody tr[data-table-name]")];
  const apply = () => {
    const value = search.value.trim().toLowerCase();
    for (const row of rows()) row.style.display = row.textContent.toLowerCase().includes(value) ? "" : "none";
  };
  search?.addEventListener("input", apply);

  const run = async (button) => {
    button.disabled = true;
    const vars = { action: button.dataset.action };
    for (const key of ["table", "field", "index", "maintenance"]) if (button.dataset[key] != null) vars[key] = button.dataset[key];
    let result;
    try {
      result = await api.cms.node(nid).api.post(vars);
      if (result.remove) rows().find((row) => row.dataset.tableName === result.remove)?.remove();
      for (const [table, rowHtml] of Object.entries(result.rows ?? {})) {
        const row = rows().find((row) => row.dataset.tableName === table);
        if (row) row.outerHTML = rowHtml;
      }
      apply();
    } catch (e) {
      result = { error: e instanceof Error ? e.message : String(e) };
    }
    const { alert } = await dialogs();
    await alert(result.error ?? result.message ?? "Done");
    if (button.isConnected) button.disabled = false;
  };

  const inspect = async (button) => {
    const body = button.closest("tr").querySelector(`template[data-inspect-body="${button.dataset.inspect}"]`);
    if (!body) return;
    const { modal } = await dialogs();
    await modal({
      body: body.innerHTML,
      buttons: [{ title: "Close" }],
      init(dialog) {
        dialog.addEventListener("click", (e) => {
          const action = e.target.closest("[data-action]");
          if (!action) return;
          dialog.close();
          run(action);
        });
      },
    });
  };

  el.addEventListener("click", (e) => {
    const button = e.target.closest("[data-action], [data-inspect]");
    if (!button) return;
    e.preventDefault();
    button.dataset.inspect ? inspect(button) : run(button);
  });
});
