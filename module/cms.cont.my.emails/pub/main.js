import { api } from "@qino/pub/api.js";
import { t } from "@qino/pub/t.js";
import { html } from "@qino/pub/html.js";

const email = api["messaging.email"];

cms.initNode("cont.my.emails", async (el) => {
  const list = el.querySelector("[data-emails]");
  const form = el.querySelector("[data-add]");
  const msg = el.querySelector(".-msg");
  const single = el.hasAttribute("data-single");
  const labels = {
    main: await t`Main address`,
    makeMain: await t`Make main address`,
    verified: await t`Verified`,
    pending: await t`Enter the code sent by email`,
    confirm: await t`Confirm`,
    resend: await t`Send code again`,
    del: await t`Delete`,
    delConfirm: await t`Delete this email address?`,
    empty: await t`No email addresses yet.`,
    sent: await t`Verification code sent.`,
    error: await t`Error loading.`,
  };

  const show = (value = "") => void (msg.value = value);
  const load = async () => {
    try {
      const { emails, pending } = await email.emails.get();
      // single: only the main one (listed first) is shown and kept
      const shown = single ? emails.slice(0, 1) : emails;
      const verified = (p) => {
        const main = p.main || shown.length === 1;
        return html`<div data-email="${p.address}">
          <p><strong>${p.address}</strong>
            ${main ? html`<span class=u2-badge>${labels.main}</span>` : ""}
            <small>${labels.verified} <u2-time datetime=${p.created * 1000} type=date></u2-time></small></p>
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

  // the verified address takes the place of all others
  const replaceOthers = async (address) => {
    const { emails } = await email.emails.get();
    for (const p of emails) if (p.address !== address) await email.email(p.address).delete();
  };

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    show();
    try {
      await email.emails.post({ address: form.elements.address.value.trim() });
      form.reset();
      show(labels.sent);
      await load();
    } catch (e) { show(e?.message || String(e)); }
  });

  list.addEventListener("click", async (event) => {
    const row = event.target.closest("[data-email], [data-pending]");
    if (!row) return;
    const address = row.dataset.pending;
    show();
    try {
      if (event.target.closest("[data-verify]")) {
        const input = row.querySelector("[data-code]");
        if (!input.reportValidity()) return;
        await email.emails.verify.post({ address, code: input.value.trim() });
        if (single) await replaceOthers(address);
      } else if (event.target.closest("[data-resend]")) {
        await email.emails.post({ address });
        show(labels.sent);
      } else if (event.target.closest("[data-main]")) {
        await email.email(row.dataset.email).main.put();
      } else if (event.target.closest("[data-delete]")) {
        if (!confirm(labels.delConfirm)) return;
        await email.email(row.dataset.email).delete();
      } else return;
      await load();
    } catch (e) { show(e?.message || String(e)); }
  });

  load();
});
