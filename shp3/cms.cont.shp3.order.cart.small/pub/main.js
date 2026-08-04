import { apt } from "../../core/pub/js/qino.js";

cms.initNode("cont.shp3.order.cart.small", (el) => {
  const nid = Number(cms.el.nid(el));
  // Whatever touched the cart — a product page, a category teaser, another tab's script.
  apt.on("POST|PUT|DELETE shp3/cart/*", () => cms.reloadNode(nid));
});
