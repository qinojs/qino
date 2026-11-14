// Delegated on document: frontend layouts have no cms.mjs. As buy1: the form is checked (terms),
// then the order tried; what blocks it comes as a message.
import { order, pay, reload } from "../../cms.shop/pub/shop.js";

const root = "[qcms-mod='cont.shop.buy']";

document.addEventListener("click", (e) => {
  const back = e.target.closest?.(`${root} .-back`);
  if (back) { e.preventDefault(); location.href = back.closest("a").href; }
});
document.addEventListener("submit", async (e) => {
  const form = e.target.closest?.(root);
  if (!form) return;
  e.preventDefault();
  const button = form.querySelector(".-buy");
  const done = new URL(form.dataset.success || location.href, location.href).href;
  button.disabled = true;
  const res = await order(done);
  const errors = Object.values(res.errors ?? {}).filter(Boolean);
  if (errors.length) alert(`${form.dataset.errors}:\n\n${errors.join("\n")}`);
  // the order stands, only the payment did not start: ask, then try again, else on to the end
  let started = res;
  while (started.paymentFailed && confirm(form.dataset.paymentFailed)) started = await pay(res.order, done);
  if (started.redirect) location.href = started.redirect;
  else if (res.ok) location.href = done;
  else reload(form);
});
