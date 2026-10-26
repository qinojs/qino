import { api } from "@qino/pub/api.js";

cms.initNode("backend.superuser.db.merge", (el) => {
  const nid = Number(cms.el.nid(el));
  const node = api.cms.node(nid);
  const dialogs = () => import("@qino/u2/js/dialog/dialog.js");

  /* the choice: a new table shows its fields at once */
  const form = el.querySelector("[data-config]");
  const configure = async () => {
    const data = new FormData(form);
    await node.api.post({ configure: 1, table: data.get("table"), same: data.getAll("same"), where: data.get("where") ?? "" });
    cms.reloadNode(nid);
  };
  form?.addEventListener("submit", (e) => { e.preventDefault(); configure(); });
  form?.querySelector("[name=table]")?.addEventListener("change", configure);

  el.addEventListener("click", async (e) => {
    const button = e.target.closest("[data-merge]");
    if (!button) return;
    const group = button.closest("[data-group]");
    const into = group.querySelector("input[type=radio]:checked")?.value;
    const from = button.dataset.merge;
    const { alert, confirm } = await dialogs();
    if (!into || into === from) return alert("Choose another row to keep.");
    if (!await confirm(`Merge #${from} into #${into}? #${from} is deleted, its references move to #${into}.`)) return;
    button.disabled = true;
    const res = await node.api.post({ merge: from, into });
    await alert(res.error ?? res.message);
    el.querySelector("[cms-part=groups]").innerHTML = await node.html.part("groups").post({ vars: {} });
  });
});
