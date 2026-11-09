// The editable tables of the shop's backend pages (renderRows): a row saves when a cell changes.
import { api } from "@qino/pub/api.js";

const values = (row) => Object.fromEntries([...row.querySelectorAll("[name]")].map((i) => [i.name, i.type === "checkbox" ? i.checked : i.value]));

async function send(el, vars) {
  const box = el.closest("[data-rows]");
  const res = await api.cms.node(Number(cms.el.nid(el))).api.post({ ...JSON.parse(box.dataset.vars), table: box.dataset.rows, ...vars });
  if (res?.ok) return res;
  const { alert } = await import("@qino/u2/js/dialog/dialog.js");
  alert(res?.error ?? "Error");
}

const reload = (el) => {
  const nid = Number(cms.el.nid(el));
  return cms.reloadNode(nid, JSON.parse(el.closest("[data-rows]").dataset.vars));
};

document.addEventListener("change", (e) => {
  const row = e.target.closest?.("[data-rows] [data-id]");
  if (row) send(row, { id: row.dataset.id, values: values(row) });
});
document.addEventListener("click", async (e) => {
  const remove = e.target.closest?.("[data-rows] .-remove");
  const create = e.target.closest?.("[data-rows] .-create");
  if (!remove && !create) return;
  const row = (remove ?? create).closest("tr");
  const res = await send(row, remove ? { remove: row.dataset.id } : { values: values(row) });
  if (res) reload(row);
});
