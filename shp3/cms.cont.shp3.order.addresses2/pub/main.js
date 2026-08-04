import { setAddress } from "../../shp3/pub/shp3.js";

cms.initNode("cont.shp3.order.addresses2", (el) => {
  const form = el.querySelector("form.-addresses");
  if (!form) return;
  const ship = el.querySelector("fieldset.-ship");

  // An unchecked checkbox is simply absent from FormData, so it has to be spelled out —
  // otherwise a delivery address could be switched on but never off again.
  const save = () => setAddress({
    ...Object.fromEntries(new FormData(form)),
    ship_unlike_bill: form.elements.ship_unlike_bill?.checked ? "1" : "",
  });

  el.addEventListener("change", (e) => {
    if (e.target.name === "ship_unlike_bill" && ship) ship.hidden = !e.target.checked;
    save();
  });
  form.addEventListener("submit", (e) => e.preventDefault());
});
