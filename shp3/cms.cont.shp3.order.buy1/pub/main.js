import { order } from "../../shp3/pub/shp3.js";

cms.initNode("cont.shp3.order.buy1", (el) => {
  const form = el.querySelector("form.-buy");
  if (!form) return;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const button = form.querySelector("button");
    button.disabled = true;
    const res = await order().catch(() => null);
    if (res?.success) {
      location.href = res.redirect || form.dataset.success || location.href;
      return;
    }
    button.disabled = false;
    // The errors belong on the page, not in a popup — the customer has to fix them above.
    location.reload();
  });
});
