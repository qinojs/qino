import { api } from "@qino/pub/qino.js";

document.addEventListener("change", async (event) => {
  const select = event.target.closest('[qcms-mod="cont.shp3.currency_chooser"] select[name=shp3_currency]');
  if (select) await api.shp3.cart.currency.put({ value: select.value });
});

document.addEventListener("click", async (event) => {
  const button = event.target.closest('[qcms-mod="cont.shp3.currency_chooser"] [data-currency]');
  if (button) await api.shp3.cart.currency.put({ value: button.dataset.currency });
});
