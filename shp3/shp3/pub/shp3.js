// The shop's client side. Everything a page can do without knowing which module rendered it:
// [shp3-add] forms add to the cart from anywhere, and [shp3-price] elements follow the form live.
//
// Nothing here announces changes — api does that itself. Whoever wants to follow the cart listens
// to the call, no matter who made it:
//
//   api.on("POST|PUT shp3/cart/*", ({ value }) => badge.set(value.cart.quantity));
import { api } from "@qino/pub/qino.js";

/** The cart in numbers — items, quantity, net, gross, currency. */
export const cart = () => api.shp3.cart.get();

export const add = (product, quantity = 1, config = null) =>
  api.shp3.cart.items.post({ product: String(product), quantity, config });

export const setQuantity = (item, quantity) => api.shp3.cart.items(item).put({ quantity });

export const remove = (item) => api.shp3.cart.items(item).delete();

/** Take over a price that moved, or drop the line if it stays broken. */
export const resolve = (item) => api.shp3.cart.items(item).solve.post();

export const choose = (what, value) => api.shp3.cart[what].put({ value });

export const setCurrency = (value) => api.shp3.cart.currency.put({ value });

export const setAddress = (values) => api.shp3.cart.address.put({ values });

export const order = (config = null) => api.shp3.cart.order.post({ config });

// A form carries the product in name=product_id; every other field is the configuration.
const formData = (form) => {
  const values = Object.fromEntries(new FormData(form));
  const product = values.product_id;
  const quantity = Number(values.quantity ?? 1);
  delete values.product_id;
  delete values.quantity;
  return { product, quantity, config: Object.keys(values).length ? values : null };
};

document.addEventListener("submit", async (e) => {
  const form = e.target.closest("[shp3-add]");
  if (!form) return;
  e.preventDefault();
  if (!form.reportValidity()) return;
  const { product, quantity, config } = formData(form);
  if (!product) throw new Error("shp3: the form has no input named product_id");
  const res = await add(product, quantity, config);
  const action = form.getAttribute("action");
  if (action && !res?.error) location.href = action;
});

// Typing in the form re-prices it: [shp3-price=gross] / [shp3-price=net] follow along.
let timer;
document.addEventListener("input", (e) => {
  const form = e.target.form?.closest("[shp3-add]");
  const targets = form?.querySelectorAll("[shp3-price]");
  if (!targets?.length) return;
  clearTimeout(timer);
  timer = setTimeout(async () => {
    const { product, quantity, config } = formData(form);
    const prices = await api.shp3.price.post({ product: String(product), quantity, config });
    if (prices?.error) return;
    for (const el of targets) {
      const value = prices[(el.getAttribute("shp3-price") || "gross") + "Text"];
      if (value != null) el.textContent = value;
    }
  }, 300);
});
