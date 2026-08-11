import { api, t } from "@qino/pub/qino.js";

// A reload replaces the whole node, the chosen filter should outlive it.
const kept = {};

cms.initNode("backend.superuser.stores", (el) => {
  const nid = Number(cms.el.nid(el));
  const node = api.cms.node(nid);
  const dialog = () => import("@qino/u2/js/dialog/dialog.js");
  const filters = () => el.querySelectorAll("[data-filter]");

  // Filter and per-store counts both derive from the rows — recompute after every change.
  const update = () => {
    for (const f of filters()) kept[f.dataset.filter] = f.value;
    const q = kept.search.trim().toLowerCase();
    const state = kept.state;
    const store = kept.store; // "-" stands for everything no store lists
    const all = [...el.querySelectorAll("tr[data-mod]")];
    for (const { dataset: d, style } of all) {
      // display, not [hidden]: .u2-table sets display:table-row on every row and would win.
      style.display = (!state || d.state === state) &&
          (!store || (store === "-" ? !d.store : d.store === store)) &&
          (!q || d.mod.toLowerCase().includes(q))
        ? ""
        : "none";
    }
    for (const out of el.querySelectorAll("[data-count]")) {
      const mine = all.filter((tr) => tr.dataset.store === out.dataset.count);
      out.textContent = `${mine.filter((tr) => tr.dataset.state !== "available").length}/${mine.length}`;
    }
  };

  const call = async (btn, vars) => {
    const tr = btn.closest("tr");
    btn.disabled = true;
    const r = await node.api.post(vars).catch((e) => ({ message: e?.message || String(e) }));
    btn.disabled = false;
    // The fresh row is the feedback; a message means there is more to it than the row shows.
    if (!r?.ok) return (await dialog()).alert(r?.message || await t`Action failed.`);
    if (r.message) await (await dialog()).alert(r.message);
    if (r.row === undefined) return cms.reloadNode(nid);
    if (r.row === null) tr.remove();
    else tr.outerHTML = r.row;
    update();
  };

  el.addEventListener("click", async (e) => {
    // A store in the overview is the filter for its modules.
    const pick = e.target.closest("[data-pick]");
    if (pick) {
      el.querySelector("[data-filter=store]").value = pick.dataset.pick;
      return update();
    }
    const btn = e.target.closest("[data-act]");
    if (!btn) return;
    const { act } = btn.dataset;
    if (act === "addStore") {
      const url = await (await dialog()).prompt(await t`Catalog URL of the store (store.json)`, "");
      if (url) call(btn, { act, store: url });
      return;
    }
    // mod and store live on the row; only the remove button of a store row carries its own.
    const { mod = "", store = "" } = { ...btn.closest("tr")?.dataset, ...btn.dataset };
    call(btn, { act, mod, store });
  });

  el.addEventListener("input", update);
  for (const f of filters()) if (kept[f.dataset.filter] !== undefined) f.value = kept[f.dataset.filter];
  update();
});
