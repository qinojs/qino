import { api } from "@qino/pub/api.js";

cms.initNode("backend.shp3.orders1", (el) => {
  const nid = Number(cms.el.nid(el));
  const node = api.cms.node(nid);
  const itemId = (target) => target.closest("[itemid]")?.getAttribute("itemid");
  const id = () => new URLSearchParams(location.search).get("shp3_orderId");

  el.addEventListener("click", async (e) => {
    const del = e.target.closest(".-delete button");
    if (del) {
      const tr = del.closest("[itemid]");
      node.api.post({ delete: itemId(del) }).then((r) => { if (r) tr.remove(); });
      return;
    }
    if (e.target.closest("button.-pay")) {
      await node.api.post({ pay: id() });
      location.reload();
      return;
    }
    if (e.target.closest("button.-place")) {
      const res = await node.api.post({ place: id() });
      if (res?.error) {
        const { alert } = await import("@qino/u2/js/dialog/dialog.js");
        await alert(res.error);
        return;
      }
      location.reload();
    }
  });
});
