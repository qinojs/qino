import { choose } from "../../shp3/pub/shp3.js";

cms.initNode("cont.shp3.order.shipping", (el) => {
  el.addEventListener("change", (e) => {
    const input = e.target.closest("input[name=shipping]");
    if (input) choose("shipping", input.value);
  });
});
