// Delegated on document: frontend layouts have no cms.mjs. Every change is stored right away (typing
// after a pause); the delivery address opens with its checkbox, and only then are its fields required.
import { setParty } from "../../cms.shop/pub/shop.js";

const root = "[qcms-mod='cont.shop.address']";
const ADDRESS = ["streetAddress", "postalCode", "addressLocality", "addressCountry"];

/** The fields of one party: the address ones under address. */
function party(box) {
  const out = { address: {} };
  for (const el of box.querySelectorAll("[name]")) {
    if (el.name === "ship_unlike_bill") continue;
    (ADDRESS.includes(el.name) ? out.address : out)[el.name] = el.value;
  }
  return out;
}
const kindOf = (el) => el.closest(".-ship") ? "ship" : "bill";
const save = (el) => {
  const box = el.closest(".-bill, .-ship");
  return kindOf(el) === "ship" && !box.querySelector("[name=ship_unlike_bill]")?.checked ? setParty("ship", undefined) : setParty(kindOf(el), party(box));
};

/** The delivery fields are required as marked, but only while they are open. */
function requireShip(form) {
  const open = form.querySelector("[name=ship_unlike_bill]")?.checked;
  for (const input of form.querySelectorAll(".-tableWrapper [name]")) {
    if (input.required) input.dataset.required = "";
    input.required = !!open && "required" in input.dataset;
  }
}

let timer;
document.addEventListener("input", (e) => {
  const el = e.target.closest?.(`${root} [name]`);
  if (!el || el.name === "ship_unlike_bill") return;
  clearTimeout(timer);
  timer = setTimeout(() => save(el), 700);
});
document.addEventListener("change", (e) => {
  const el = e.target.closest?.(`${root} [name]`);
  if (!el) return;
  if (el.name === "ship_unlike_bill") {
    el.closest(".-ship").querySelector(".-tableWrapper").hidden = !el.checked;
    requireShip(el.form);
  }
  clearTimeout(timer);
  save(el);
});
document.addEventListener("submit", (e) => {
  if (e.target.closest?.(root)) e.preventDefault();
});
addEventListener("DOMContentLoaded", () => document.querySelectorAll(`${root} form`).forEach(requireShip));
