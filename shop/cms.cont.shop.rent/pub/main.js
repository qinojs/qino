// Delegated on document: frontend layouts have no cms.mjs.
import { add, reload, remove } from "../../cms.shop/pub/shop.js";

const root = "[qcms-mod='cont.shop.rent']";

document.addEventListener("click", async (e) => {
  const button = e.target.closest?.(`${root} button`);
  if (!button || button.disabled) return;
  const el = button.closest(root), { begin, end, line, to } = button.dataset;
  if (to != null) return reload(el, { week: Number(to) });
  if (line) await remove(line);
  else if (begin) await add(el.dataset.product, { data: { rent: [{ begin: Number(begin), end: Number(end) }] } });
  else return;
  reload(el, { week: Number(el.dataset.week) });
});
