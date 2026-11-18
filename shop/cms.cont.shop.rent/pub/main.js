import { cms, initNode } from "@qino/m/cms/pub/js/cms.js";
import { add, remove } from "../../cms.shop/pub/shop.js";

initNode("cont.shop.rent", (el) => el.addEventListener("click", async (e) => {
  const button = e.target.closest("button");
  if (!button || button.disabled) return;
  const { begin, end, line, to } = button.dataset;
  if (to != null) return cms.reloadNode(cms.el.nid(el), { week: Number(to) });
  if (line) await remove(line);
  else if (begin) await add(el.dataset.product, { data: { rent: [{ begin: Number(begin), end: Number(end) }] } });
  else return;
  cms.reloadNode(cms.el.nid(el), { week: Number(el.dataset.week) });
}));
