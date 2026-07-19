import { apt } from "../../core/pub/js/qino.js";

const nextCap = (v) => (v === "1" ? "2" : v === "2" ? "3" : "1");                    // grp cap: 1→2→3→1
const nextDef = (v) => (v === "" ? "0" : v === "3" ? "" : String(Number(v) + 1));   // ceiling: ""→0→1→2→3→""
const nextUpTo = (v, max) => (v === "" ? "0" : Number(v) + 1 > max ? "" : String(Number(v) + 1)); // override: ""→0..max→""

cms.initNode("backend.cms.accessRules", (el) => {
  const nid = Number(cms.el.nid(el));
  const post = (vars) => apt.cms.node(nid).html.post({ vars });
  const labels = JSON.parse(el.dataset.labels || "{}");
  const setCell = (cell, v) => { cell.setAttribute("v", v); cell.textContent = labels[v] ?? "–"; };
  const grpCap = (grp) => Number(el.querySelector(`td.-cell[data-kind=cap][data-grp="${grp}"]`)?.getAttribute("v")) || 3;

  el.addEventListener("click", async (e) => {
    const cell = e.target.closest(".cmsAccessRules td.-cell");
    if (!cell) return;
    const kind = cell.dataset.kind, cur = cell.getAttribute("v") ?? "";
    const next = kind === "cap" ? nextCap(cur)
      : kind === "override" ? nextUpTo(cur, grpCap(cell.dataset.grp)) // can't exceed the group's cap
      : nextDef(cur);
    const vars = { access: next };
    if (kind === "cap") { vars.set_cap = 1; vars.grp = cell.dataset.grp; }
    else if (kind === "ceiling") { vars.set_ceiling = 1; vars.module = cell.dataset.module; }
    else { vars.set_access = 1; vars.module = cell.dataset.module; vars.grp = cell.dataset.grp; }
    await post(vars);
    setCell(cell, next);
  });

  el.querySelector("[data-search]")?.addEventListener("input", (e) => {
    const q = e.target.value.toLowerCase();
    el.querySelectorAll("tbody tr[data-name]").forEach((tr) =>
      tr.style.display = tr.dataset.name.toLowerCase().includes(q) ? "" : "none");
  });

  el.querySelector("[data-check-all]")?.addEventListener("change", (e) => {
    el.querySelectorAll("tbody tr[data-name]").forEach((tr) => {
      if (tr.style.display !== "none") tr.querySelector("[data-check]").checked = e.target.checked;
    });
  });

  // bulk: set the chosen column (standard ceiling or a group override) for all checked modules
  el.querySelector("[data-bulk-apply]")?.addEventListener("click", async () => {
    const col = el.querySelector("[data-bulk-col]").value;
    let v = el.querySelector("[data-bulk]").value;
    const rows = [...el.querySelectorAll("tbody tr[data-name]")].filter((tr) => tr.querySelector("[data-check]").checked);
    if (!rows.length) return;
    const modules = rows.map((tr) => tr.dataset.name).join(",");
    if (col === "standard") {
      await post({ bulk_ceiling: 1, modules, access: v });
      rows.forEach((tr) => setCell(tr.querySelector("td[data-kind=ceiling]"), v));
    } else {
      if (v !== "" && v !== "0") v = String(Math.min(Number(v), grpCap(col))); // can't exceed the group's cap
      await post({ bulk_override: 1, modules, grp: col, access: v });
      rows.forEach((tr) => setCell(tr.querySelector(`td[data-kind=override][data-grp="${col}"]`), v));
    }
    rows.forEach((tr) => tr.querySelector("[data-check]").checked = false);
    el.querySelector("[data-check-all]").checked = false;
  });

  el.querySelector(".-add-group")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = e.target;
    await post({ add_group: 1, grp: f.grp.value, new_group: f.new_group?.value ?? "", cap: f.cap.value });
    location.reload();
  });
});
