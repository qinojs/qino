import { api, hee, t } from "@qino/pub/qino.js";

const sms = api["messaging.sms"];
const fmt = (ts) => ts ? new Date(ts * 1000).toLocaleDateString() : "";

cms.initNode("cont.my.phones", async (el) => {
  const list = el.querySelector("[data-phones]");
  const form = el.querySelector("[data-add]");
  const msg = el.querySelector(".-msg");
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
      const verified = (p) => {
        const main = p.main || phones.length === 1;
        return `<div data-phone="${hee(p.address)}">
          <p><strong>${hee(p.address)}</strong>
            ${main ? `<span class=u2-badge>${hee(labels.main)}</span>` : ""}
            <small>${hee(labels.verified)} ${hee(fmt(p.created))}</small></p>
          ${main ? "" : `<button type=button data-main>${hee(labels.makeMain)}</button>`}
          <button type=button data-delete>${hee(labels.del)}</button>
        </div>`;
      };
      const claimed = (p) => `<div data-pending="${hee(p.address)}">
        <p><strong>${hee(p.address)}</strong></p>
        <label>${hee(labels.pending)} <input inputmode=numeric pattern="[0-9]{6}" maxlength=6 data-code required></label>
        <button type=button data-verify>${hee(labels.confirm)}</button>
        <button type=button data-resend>${hee(labels.resend)}</button>
      </div>`;
      list.innerHTML = phones.length || pending.length
        ? phones.map(verified).join("") + pending.map(claimed).join("")
        : hee(labels.empty);
    } catch (e) {
      list.textContent = labels.error;
      show(e?.message || String(e));
    }
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
