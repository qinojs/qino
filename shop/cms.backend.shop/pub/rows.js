// The editable tables of the shop's backend pages (renderRows): a row saves when a cell changes.
import { api } from "@qino/pub/api.js";

const values = (row) => Object.fromEntries([...row.querySelectorAll("[name]")].map((i) => [i.name, i.type === "checkbox" ? i.checked : i.value]));

async function send(el, vars) {
  const box = el.closest("[data-rows]");
  const res = await api.cms.node(Number(cms.el.nid(el))).api.post({ ...JSON.parse(box.dataset.vars), table: box.dataset.rows, ...vars });
  if (res?.ok) return res;
  const { alert } = await import("@qino/u2/js/dialog/dialog.js");
  alert("Error");
}

document.addEventListener("change", async (e) => {
  const setting = e.target.closest?.("[data-settings] [name]");
  if (setting) return api.cms.node(Number(cms.el.nid(setting))).api.post({ setting: setting.name, value: setting.type === "checkbox" ? setting.checked : setting.value });
  const row = e.target.closest?.("[data-rows] [data-id]");
  if (!row) return;
  const res = await send(row, { id: row.dataset.id, values: values(row) });
  if (res && "reload" in e.target.dataset) cms.reloadNode(Number(cms.el.nid(row)), JSON.parse(row.closest("[data-rows]").dataset.vars));
});
document.addEventListener("click", async (e) => {
  const remove = e.target.closest?.("[data-rows] .-remove");
  const create = e.target.closest?.("[data-rows] .-create");
  if (!remove && !create) return;
  const row = (remove ?? create).closest("tr");
  const res = await send(row, remove ? { remove: row.dataset.id } : { values: values(row) });
  if (res) cms.reloadNode(Number(cms.el.nid(row)), JSON.parse(row.closest("[data-rows]").dataset.vars));
});

// a long table narrows to what is typed above it: the texts and typed values of a row, not its choices
const textOf = (tr) => [...tr.cells].filter((td) => !td.querySelector("select"))
  .map((td) => td.textContent + [...td.querySelectorAll("input:not([type=checkbox])")].map((i) => i.value).join(" ")).join(" ").toLowerCase();
document.addEventListener("input", (e) => {
  const search = e.target.closest?.("[data-rows] .-search");
  if (!search) return;
  const term = search.value.trim().toLowerCase();
  for (const tr of search.closest("[data-rows]").querySelectorAll("tbody tr")) tr.hidden = !!term && !textOf(tr).includes(term);
});
