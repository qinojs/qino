import { api } from "@qino/pub/api.js";
import { t } from "@qino/pub/t.js";
import { html } from "@qino/pub/html.js";

const sms = api["messaging.sms"];
const fmt = (ts) => ts ? new Date(ts * 1000).toLocaleDateString() : "";

cms.initNode("cont.my.phones", async (el) => {
  const list = el.querySelector("[data-phones]");
  const form = el.querySelector("[data-add]");
  const msg = el.querySelector(".-msg");
  const single = el.hasAttribute("data-single");
  const labels = {
    main: await t`Main number`,
    makeMain: await t`Make main number`,
    verified: await t`Verified`,
    pending: await t`Enter the code sent by SMS`,
    confirm: await t`Confirm`,
    resend: await t`Send code again`,
    del: await t`Delete`,
    delConfirm: await t`Delete this phone number?`,
    empty: await t`No phone numbers yet.`,
    sent: await t`Verification code sent.`,
    error: await t`Error loading.`,
  };

  const show = (value = "") => void (msg.value = value);
  const load = async () => {
    try {
      const { phones, pending } = await sms.phones.get();
      // single: only the main one (listed first) is shown and kept
      const shown = single ? phones.slice(0, 1) : phones;
      const verified = (p) => {
        const main = p.main || shown.length === 1;
        return html`<div data-phone="${p.address}">
          <p><strong>${p.address}</strong>
            ${main ? html`<span class=u2-badge>${labels.main}</span>` : ""}
            <small>${labels.verified} ${fmt(p.created)}</small></p>
          ${main ? "" : html`<button type=button data-main>${labels.makeMain}</button>`}
          ${single ? "" : html`<button type=button data-delete>${labels.del}</button>`}
        </div>`;
      };
      const claimed = (p) => html`<div data-pending="${p.address}">
        <p><strong>${p.address}</strong></p>
        <label>${labels.pending} <input inputmode=numeric pattern="[0-9]{6}" maxlength=6 data-code required></label>
        <button type=button data-verify>${labels.confirm}</button>
        <button type=button data-resend>${labels.resend}</button>
      </div>`;
      list.innerHTML = shown.length || pending.length
        ? html`${shown.map(verified)}${pending.map(claimed)}`
        : labels.empty;
    } catch (e) {
      list.textContent = labels.error;
      show(e?.message || String(e));
    }
  };

  // the verified number takes the place of all others
  const replaceOthers = async (number) => {
    const { phones } = await sms.phones.get();
    for (const p of phones) if (p.address !== number) await sms.phone(p.address).delete();
  };

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    show();
    try {
      await sms.phones.post({ number: form.elements.number.value.trim() });
      form.reset();
      show(labels.sent);
      await load();
    } catch (e) { show(e?.message || String(e)); }
  });

  list.addEventListener("click", async (event) => {
    const row = event.target.closest("[data-phone], [data-pending]");
    if (!row) return;
    const number = row.dataset.pending;
    show();
    try {
      if (event.target.closest("[data-verify]")) {
        const input = row.querySelector("[data-code]");
        if (!input.reportValidity()) return;
        await sms.phones.verify.post({ number, code: input.value.trim() });
        if (single) await replaceOthers(number);
      } else if (event.target.closest("[data-resend]")) {
        await sms.phones.post({ number });
        show(labels.sent);
      } else if (event.target.closest("[data-main]")) {
        await sms.phone(row.dataset.phone).main.put();
      } else if (event.target.closest("[data-delete]")) {
        if (!confirm(labels.delConfirm)) return;
        await sms.phone(row.dataset.phone).delete();
      } else return;
      await load();
    } catch (e) { show(e?.message || String(e)); }
  });

  load();
});
