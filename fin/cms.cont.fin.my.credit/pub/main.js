import { api } from "@qino/pub/api.js";
import { t } from "@qino/pub/t.js";
import { html } from "@qino/pub/html.js";

import { money } from "../../fin/pub/money.js";

const credit = api["fin.payment.credit"];
const fmt = (ts) => ts ? new Date(ts * 1000).toLocaleDateString() : "";

cms.initNode("cont.fin.my.credit", async (el) => {
  const box = el.querySelector("[data-credit]");
  const msg = el.querySelector(".-msg");
  const labels = {
    balance: await t`Credit`,
    empty: await t`No credit.`,
    error: await t`Error loading.`,
  };
  try {
    const { balances, moves } = await credit.get();
    box.innerHTML = html`<p><strong>${labels.balance}</strong>
      ${balances.length ? balances.map((b) => money(b.amount, b.currency)).join(" · ") : labels.empty}</p>
      ${moves.length ? html`<table class=u2-table>${moves.map((m) => html`<tr>
        <td>${fmt(m.created)}
        <td>${money(m.amount, m.currency)}
        <td>${m.text}`)}
      </table>` : ""}`;
  } catch (e) {
    box.textContent = labels.error;
    msg.value = e?.message || String(e);
  }
});
