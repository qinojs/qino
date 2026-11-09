// Shop client: [shop-add] forms add to the cart from anywhere.
//
// To follow cart changes, listen to the api calls:
//
//   api.on("POST|PUT|DELETE cms.shop/cart/*", ({ value }) => badge.set(value.cart.quantity));
import { api } from "@qino/pub/api.js";

const shop = api["cms.shop"];

/** The cart in numbers — lines, quantity, total, currency. */
export const cart = () => shop.cart.get();

export const add = (product, { variant, quantity = 1, data } = {}) =>
  shop.cart.lines.post({ product: String(product), variant: variant ? String(variant) : undefined, quantity, data });

export const setQuantity = (line, quantity) => shop.cart.lines(line).put({ quantity });

export const remove = (line) => shop.cart.lines(line).delete();

export const solve = (line, solution) => shop.cart.lines(line).solve.post({ solution });

export const choose = (what, value) => shop.cart[what].put({ value });

export const setParty = (kind, party) => shop.cart.party.put({ kind, party });

export const setCurrency = (value) => shop.cart.currency.put({ value });

export const setData = (values) => shop.cart.data.put({ values });

/** Render a node anew in place, with vars for its render — frontend layouts need not load cms.mjs,
 *  so not cms.reloadNode. */
export const reload = (el, vars = {}) => {
  const nid = el.closest("[qcms-id]").getAttribute("qcms-id");
  return api.cms.node(Number(nid)).html.post({ vars }).then((html) =>
    document.querySelectorAll(`[qcms-id="${nid}"]`).forEach((n) => n.outerHTML = html));
};

/** Place the order; the answer may send the payer to the payment. */
export const order = (back = location.href) => shop.cart.order.post({ return: back });

/** Start the payment of a placed order again. */
export const pay = (id, back = location.href) => shop.order(id).pay.post({ return: back });

/** Fields of a form as data: `options[Box]` is `{ options: { Box } }`. */
const dataOf = (form) => {
  const data = {};
  for (const [name, value] of new FormData(form)) {
    if (["product", "variant", "quantity"].includes(name)) continue;
    const [, group, key] = /^(.+)\[(.+)\]$/.exec(name) ?? [];
    if (group) (data[group] ??= {})[key] = value;
    else data[name] = value;
  }
  return Object.keys(data).length ? data : undefined;
};

// [shop-price] inside a buying form follows what is picked in it
document.addEventListener("change", async (e) => {
  const form = e.target.closest?.("[shop-add]"), shown = form?.querySelector("[shop-price]");
  if (!shown) return;
  const res = await shop.price.post({ product: form.elements.product.value, variant: form.elements.variant?.value || undefined, quantity: Number(form.elements.quantity?.value ?? 1), data: dataOf(form) });
  if (res?.grossText) shown.textContent = res.grossText;
});

// A form names the product (product), optionally the variant and the amount; every other field
// is the line's data. Several amounts at once: inputs named quantity inside elements carrying
// data-variant.
document.addEventListener("submit", async (e) => {
  const form = e.target.closest("[shop-add]");
  if (!form) return;
  e.preventDefault();
  if (!form.reportValidity()) return;
  const product = form.elements.product?.value;
  if (!product) throw new Error("cms.shop: the form has no input named product");
  const data = dataOf(form);
  const rows = [...form.querySelectorAll("[data-variant]")];
  const picks = rows.length
    ? rows.map((row) => ({ variant: row.dataset.variant, quantity: Number(row.querySelector("[name=quantity]")?.value ?? 0), data }))
    : [{ variant: form.elements.variant?.value, quantity: Number(form.elements.quantity?.value ?? 1), data }];
  let res;
  for (const pick of picks.filter((p) => p.quantity > 0)) res = await add(product, pick);
  const action = form.getAttribute("action");
  if (action && res && !res.error) location.href = action;
});
