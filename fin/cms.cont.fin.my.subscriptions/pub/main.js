import { cms } from "@qino/m/cms/pub/js/cms.mjs";
import { api } from "@qino/pub/api.js";
import { t } from "@qino/pub/t.js";
import { html } from "@qino/pub/html.js";

import { day, money } from "../../fin/pub/money.js";

const subscriptions = api["fin.subscription"];

cms.initNode("cont.fin.my.subscriptions", async (el) => {
  const list = el.querySelector("[data-subscriptions]");
  const msg = el.querySelector(".-msg");
  const labels = {
    what: await t`Subscription`,
    price: await t`Price`,
    renews: await t`Renews`,
    ends: await t`Ends`,
    month: await t`month`,
    year: await t`year`,
    cancel: await t`Cancel subscription`,
    cancelConfirm: await t`Cancel this subscription? It ends with the period under way.`,
    empty: await t`No subscriptions.`,
    error: await t`Error loading.`,
  };
  const show = (value = "") => void (msg.value = value);
  const every = (s) => `${Number(s.count) > 1 ? `${s.count} ` : ""}${s.unit === "month" ? labels.month : labels.year}`;

  const load = async () => {
    try {
      const rows = await subscriptions.subscriptions.get();
      list.innerHTML = rows.length
        ? html`<table class=u2-table>
          <thead><tr>
            <th>${labels.what}
            <th>${labels.price}
            <th>${labels.renews}
            <th>${labels.ends}
            <th>
          <tbody>${rows.map((s) => html`<tr data-id="${s.id}">
            <td>${s.label} ${s.detail ? html`<small>${s.detail}</small>` : ""}
            <td>${money(s.amount, s.currencyCode)} / ${every(s)}
            <td>${s.end_date ? "" : day(s.next)}
            <td>${day(s.end_date)}
            <td>${s.end_date ? "" : html`<button type=button data-cancel>${labels.cancel}</button>`}`)}
        </table>`
        : labels.empty;
    } catch (e) {
      list.textContent = labels.error;
      show(e?.message || String(e));
    }
  };

  el.addEventListener("click", async (event) => {
    const id = event.target.closest("[data-id]")?.dataset.id;
    if (!id || !event.target.closest("[data-cancel]") || !confirm(labels.cancelConfirm)) return;
    show();
    try {
      await subscriptions.subscription(id).cancel.post();
      await load();
    } catch (e) { show(e?.message || String(e)); }
  });

  load();
});
