import { cms } from "@qino/m/cms/pub/js/cms.mjs";
import { api } from "@qino/pub/api.js";
import { t } from "@qino/pub/t.js";
import { html } from "@qino/pub/html.js";

import { day, money } from "../../fin/pub/money.js";

cms.initNode("cont.fin.my.domains", async (el) => {
  const list = el.querySelector("[data-domains]");
  const labels = {
    domain: await t`Domain`,
    billed: await t`Billed by`,
    renews: await t`Renews`,
    alias: await t`Alias of`,
    month: await t`month`,
    year: await t`year`,
    empty: await t`No domains.`,
    error: await t`Error loading.`,
  };
  const every = (s) => `${Number(s.count) > 1 ? `${s.count} ` : ""}${s.unit === "month" ? labels.month : labels.year}`;
  const running = (s) => !s.end_date || String(s.next) < String(s.end_date).slice(0, 10);
  try {
    const rows = await api["fin.hosting"].domains.get();
    list.innerHTML = rows.length
      ? html`<table class=u2-table>
        <thead><tr>
          <th>${labels.domain}
          <th>${labels.billed}
          <th>${labels.renews}
        <tbody>${rows.map((d) => {
          const subs = d.subscriptions.filter(running);
          return html`<tr>
            <td>${d.alias_of ? html`<small>↳</small> ` : ""}<a href="https://${d.name}/" target=_blank rel=noopener>${d.name}</a>
              ${d.alias_of ? html`<br><small>${labels.alias} ${d.alias_of}</small>` : ""}
            <td>${subs.map((s) => html`<div>${s.label} <small>${money(s.amount, s.currencyCode)} / ${every(s)}</small></div>`)}
            <td>${subs.map((s) => html`<div>${day(s.next)}</div>`)}`;
        })}
      </table>`
      : labels.empty;
  } catch (e) {
    list.textContent = labels.error;
    el.querySelector(".-msg").value = e?.message || String(e);
  }
});
