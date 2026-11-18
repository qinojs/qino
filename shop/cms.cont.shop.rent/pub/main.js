// Delegated on document.
import { add, remove } from "../../cms.shop/pub/shop.js";
import { cms } from "@qino/m/cms/pub/js/cms.js";

const root = "[qcms-mod='cont.shop.rent']";

document.addEventListener("click", async (e) => {
  const button = e.target.closest?.(`${root} button`);
  if (!button || button.disabled) return;
  const el = button.closest(root), { begin, end, line, to } = button.dataset;
  if (to != null) return cms.reloadNode(cms.el.nid(el), { week: Number(to) });
  if (line) await remove(line);
  else if (begin) await add(el.dataset.product, { data: { rent: [{ begin: Number(begin), end: Number(end) }] } });
  else return;
  cms.reloadNode(cms.el.nid(el), { week: Number(el.dataset.week) });
});
