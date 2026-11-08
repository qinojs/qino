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

export const choose = (what, value) => shop.cart[what].put({ value });

export const setParty = (kind, party) => shop.cart.party.put({ kind, party });

export const setData = (values) => shop.cart.data.put({ values });

/** Render a node anew in place — frontend layouts need not load cms.mjs, so not cms.reloadNode. */
export const reload = (el) => {
  const nid = el.closest("[qcms-id]").getAttribute("qcms-id");
  return api.cms.node(Number(nid)).html.post({}).then((html) =>
    document.querySelectorAll(`[qcms-id="${nid}"]`).forEach((n) => n.outerHTML = html));
};

/** Place the order; the answer may send the payer to the payment. */
export const order = (back = location.href) => shop.cart.order.post({ return: back });

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
  const fields = Object.fromEntries([...new FormData(form)].filter(([name]) => !["product", "variant", "quantity"].includes(name)));
  const data = Object.keys(fields).length ? fields : undefined;
  const rows = [...form.querySelectorAll("[data-variant]")];
  const picks = rows.length
    ? rows.map((row) => ({ variant: row.dataset.variant, quantity: Number(row.querySelector("[name=quantity]")?.value ?? 0), data }))
    : [{ variant: form.elements.variant?.value, quantity: Number(form.elements.quantity?.value ?? 1), data }];
  let res;
  for (const pick of picks.filter((p) => p.quantity > 0)) res = await add(product, pick);
  const action = form.getAttribute("action");
  if (action && res && !res.error) location.href = action;
});
