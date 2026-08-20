import { api } from "@qino/pub/qino.js";

cms.initNode("backend.users", (el) => {
  const nid = Number(cms.el.nid(el));
  const node = api.cms.node(nid);
  const itemId = (target) => target.closest("[itemid]")?.getAttribute("itemid");

  // overview: live search / group filter → reload list part
  const search = el.querySelector("#usrSearch");
  const grpSel = el.querySelector("#usrGrp");
  const reloadList = () => {
    const url = new URL(location);
    grpSel?.value ? url.searchParams.set("grp_id", grpSel.value) : url.searchParams.delete("grp_id");
    history.replaceState(null, "", url);
    cms.reloadPart(nid, "list", { search: search?.value ?? "", grp_id: grpSel?.value ?? "" });
  };
  let timer;
  search?.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(reloadList, 250);
  });
  grpSel?.addEventListener("change", reloadList);

  // detail: contacts — the address is the identity, so channel and address travel together
  const reloadContacts = () => cms.reloadPart(nid, "contacts", { id: el.querySelector("[itemid]")?.getAttribute("itemid") ?? "" });
  const contactVars = (button, key) => {
    const [channel, ...rest] = button.dataset[key].split(":");
    return { channel, address: rest.join(":") };
  };
  const contactResult = (response) => {
    if (response?.ok) return reloadContacts();
    if (response?.message) return import("@qino/u2/js/dialog/dialog.js").then((d) => d.alert(response.message));
  };

  el.addEventListener("click", (e) => {
    const save = e.target.closest("[data-contact-save]");
    if (save) {
      const form = save.closest("form");
      node.api.post({
        contact_add: itemId(save),
        channel: form.elements.channel.value,
        address: form.elements.address.value.trim(),
      }).then(contactResult);
      return;
    }
    const contactDel = e.target.closest("[data-contact-delete]");
    if (contactDel) {
      node.api.post({ contact_delete: itemId(contactDel), ...contactVars(contactDel, "contactDelete") }).then(contactResult);
      return;
    }
    const contactMain = e.target.closest("[data-main]");
    if (contactMain) {
      node.api.post({ contact_main: itemId(contactMain), ...contactVars(contactMain, "main") }).then(contactResult);
      return;
    }
    const del = e.target.closest(".-delete button");
    if (del) {
      const tr = del.closest("[itemid]");
      node.api.post({ delete: itemId(del) }).then((ok) => { if (ok) tr.remove(); });
      return;
    }
    const loginAs = e.target.closest(".-loginAs");
    if (loginAs) node.api.post({ login_as: itemId(loginAs) }).then((ok) => { if (ok) location.href = globalThis.qino?.appUrl ?? "/"; });
  });

  // detail: save field on change / toggle group membership
  el.addEventListener("change", (e) => {
    const field = e.target.closest(".-detail [name]");
    if (field) {
      const value = field.type === "checkbox" ? (field.checked ? field.value : "0") : field.value;
      node.api.post({ save: itemId(field), name: field.name, value });
      return;
    }
    const grp = e.target.closest(".-set_grp input[type=checkbox]");
    if (grp) node.api.post({ set_grp: itemId(grp), grp_id: grp.value, add: grp.checked ? 1 : 0 });
  });
});
