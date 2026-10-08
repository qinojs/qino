import { api } from "@qino/pub/api.js";
import { t } from "@qino/pub/t.js";
import { html } from "@qino/pub/html.js";

import { day, money } from "../../fin/pub/money.js";

const invoices = api["fin.invoice"];

cms.initNode("cont.fin.my.invoices", async (el) => {
  const list = el.querySelector("[data-invoices]");
  const msg = el.querySelector(".-msg");
  const labels = {
    invoice: await t`Invoice`,
    creditNote: await t`Credit note`,
    date: await t`Date`,
    due: await t`Due`,
    total: await t`Total`,
    open: await t`Open`,
    status: await t`Status`,
    overdue: await t`overdue`,
    pdf: await t`PDF`,
    pay: await t`Pay`,
    none: await t`It cannot be paid online.`,
    empty: await t`No invoices yet.`,
    error: await t`Error loading.`,
    statuses: { open: await t`open`, paid: await t`paid`, canceled: await t`canceled` },
  };
  const show = (value = "") => void (msg.value = value);
  const today = new Date().toLocaleDateString("sv-SE");

  // what is still owed, and whether it is paid here: an issued invoice of the shop, not a credit note
  const rest = (i) => Number(i.total) - Number(i.paid);
  const payable = (i) => i.status === "open" && i.direction === "out" && i.type === "invoice" && rest(i) > 0;

  const row = (i) => html`<tr data-id="${i.id}">
    <td>${i.type === "credit_note" ? labels.creditNote : labels.invoice} ${i.number}
    <td>${day(i.date)}
    <td>${day(i.due)} ${payable(i) && i.due && i.due < today ? html`<span class=u2-badge>${labels.overdue}</span>` : ""}
    <td>${money(i.total, i.currency)}
    <td>${payable(i) ? money(rest(i), i.currency) : ""}
    <td>${labels.statuses[i.status] ?? i.status}
    <td data-actions>
      <button type=button data-pdf>${labels.pdf}</button>
      ${payable(i) ? html`<button type=button data-pay>${labels.pay}</button>` : ""}`;

  const load = async () => {
    try {
      const rows = await invoices.invoices.get();
      list.innerHTML = rows.length
        ? html`<table class=u2-table>
          <thead><tr>
            <th>${labels.invoice}
            <th>${labels.date}
            <th>${labels.due}
            <th>${labels.total}
            <th>${labels.open}
            <th>${labels.status}
            <th>
          <tbody>${rows.map(row)}
        </table>`
        : labels.empty;
    } catch (e) {
      list.textContent = labels.error;
      show(e?.message || String(e));
    }
  };

  // on to where it is paid: the provider's page, or the slip (a QR bill)
  const pay = async (id, method) => {
    const { redirect } = await invoices.invoice(id).pay.post({ method, return: location.href });
    location.href = redirect;
  };

  el.addEventListener("click", async (event) => {
    const id = event.target.closest("[data-id]")?.dataset.id;
    if (!id) return;
    show();
    try {
      if (event.target.closest("[data-pdf]")) {
        // a tab opened at the click, or the browser blocks it
        const tab = globalThis.open("about:blank");
        const { url } = await invoices.invoice(id).pdf.get().catch((e) => (tab?.close(), Promise.reject(e)));
        tab.location = url;
      } else if (event.target.closest("[data-pay]")) {
        const ways = await invoices.invoice(id).methods.get();
        if (!ways.length) return show(labels.none);
        if (ways.length === 1) return await pay(id, ways[0].method);
        // several ways: the user chooses
        event.target.closest("[data-actions]").innerHTML = html`<form data-way>
          <select name=method>${ways.map((w) => html`<option value="${w.method}">${w.label}`)}</select>
          <button>${labels.pay}</button>
        </form>`;
      }
    } catch (e) { show(e?.message || String(e)); }
  });

  el.addEventListener("submit", async (event) => {
    const form = event.target.closest("[data-way]");
    if (!form) return;
    event.preventDefault();
    try {
      await pay(form.closest("[data-id]").dataset.id, form.elements.method.value);
    } catch (e) { show(e?.message || String(e)); }
  });

  load();
});
