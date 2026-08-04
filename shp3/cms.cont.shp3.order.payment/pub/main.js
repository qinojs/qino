import { choose } from "../../shp3/pub/shp3.js";

cms.initNode("cont.shp3.order.payment", (el) => {
  el.addEventListener("change", (e) => {
    const input = e.target.closest("input[name=payment]");
    if (input) choose("payment", input.value);
  });
});
