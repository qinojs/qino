import { api } from "@qino/pub/api.js";

import { remove, resolve, setQuantity } from "../../shp3/pub/shp3.js";

cms.initNode("cont.shp3.order.cart1", (el) => {
  const nid = Number(cms.el.nid(el));
  const itemId = (target) => target.closest("[itemid]")?.getAttribute("itemid");
  const total = (res) => { if (res?.cart) el.querySelector(".-sum").textContent = res.cart.grossText; };

  // Anything that touched the cart elsewhere on the page belongs in this table too.
  api.on("POST shp3/cart/items", () => cms.reloadNode(nid));

  el.addEventListener("change", (e) => {
    const input = e.target.closest("input.-q");
    if (!input) return;
    const tr = input.closest("[itemid]");
    setQuantity(itemId(input), Number(input.value)).then((res) => {
      if (!res.quantity) tr.remove();
      total(res);
    });
  });

  el.addEventListener("click", (e) => {
    const button = e.target.closest(".-rem button, .-resolve");
    if (!button) return;
    const tr = button.closest("[itemid]");
    if (button.classList.contains("-resolve")) {
      // A fix may change prices anywhere in the table, so the whole node comes back.
      resolve(itemId(button)).then(() => cms.reloadNode(nid));
      return;
    }
    remove(itemId(button)).then((res) => { tr.remove(); total(res); });
  });
});
