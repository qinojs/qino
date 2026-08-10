import { api, t } from "@qino/pub/qino.js";

cms.initNode("backend.groups", (el) => {
  const nid = Number(cms.el.nid(el));
  const node = api.cms.node(nid);
  const itemId = (target) => target.closest("[itemid]")?.getAttribute("itemid");
  let alertFn;
  const alert = async (text) => (alertFn ??= (await import("@qino/u2/js/dialog/dialog.js")).alert)(text);

  const onMemberResult = async (r, onOk) => {
    if (r?.error) return alert(r.error);
    if (!r) return alert(await t`Action failed.`);
    await onOk?.();
  };

  el.addEventListener("click", (e) => {
    const del = e.target.closest(".-delete button");
    if (del) {
      const tr = del.closest("[itemid]");
      node.api.post({ delete: itemId(del) }).then((ok) => { if (ok) tr.remove(); });
      return;
    }
    const rm = e.target.closest(".-members .-remove");
    if (rm) {
      const tr = rm.closest("tr");
      node.api.post({ set_usr: itemId(rm), usr_id: rm.dataset.usr, add: 0 })
        .then((r) => onMemberResult(r, () => tr.remove()));
    }
  });

  // save field on change (overview rows and detail share the [itemid] scope)
  el.addEventListener("change", (e) => {
    const field = e.target.closest("[name]");
    const id = field && itemId(field);
    if (!id) return;
    node.api.post({ save: id, name: field.name, value: field.value });
  });

  // detail: add member by email
  const addForm = el.querySelector("[data-add-member]");
  addForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const r = await node.api.post({ add_email: itemId(addForm), email: addForm.email.value });
    await onMemberResult(r, () => cms.reloadNode(nid));
  });
});
