import { api, hee, t } from "@qino/pub/qino.js";

const totp = api["auth.totp"];
const fmt = (ts) => ts ? new Date(ts * 1000).toLocaleDateString() : "";

cms.initNode("cont.my.totp", async (el) => {
  const list = el.querySelector("[data-apps]");
  const setup = el.querySelector("[data-setup]");
  const start = el.querySelector("[data-start]");
  const msg = el.querySelector(".-msg");
  const labels = {
    added: await t`Set up`,
    lastUsed: await t`Last used`,
    never: await t`Never used`,
    unnamed: await t`Authenticator app`,
    del: await t`Remove`,
    delConfirm: await t`Remove this authenticator app?`,
    empty: await t`No authenticator app yet.`,
    scan: await t`Scan this with your authenticator app, then enter what it shows.`,
    byHand: await t`Or type the secret by hand:`,
    name: await t`What is this device called?`,
    code: await t`6-digit code`,
    confirm: await t`Confirm`,
    cancel: await t`Cancel`,
    done: await t`Set up. The app can prove it is you from now on.`,
    error: await t`Error loading.`,
  };

  const show = (value = "") => void (msg.value = value);

  const load = async () => {
    try {
      const apps = await totp.get();
      list.innerHTML = apps.length
        ? apps.map((app) => `<div data-app="${app.id}">
            <p><strong>${hee(app.label || labels.unnamed)}</strong>
              <small>${hee(labels.added)} ${hee(fmt(app.created))} ·
                ${app.lastUsed ? `${hee(labels.lastUsed)} ${hee(fmt(app.lastUsed))}` : hee(labels.never)}</small></p>
            <button type=button data-delete>${hee(labels.del)}</button>
          </div>`).join("")
        : hee(labels.empty);
    } catch (e) {
      list.textContent = labels.error;
      show(e?.message || String(e));
    }
  };

  start.addEventListener("click", async () => {
    show();
    try {
      const { secret, uri } = await totp.enrol.post();
      setup.innerHTML = `<form>
        <p>${hee(labels.scan)}</p>
        <u2-qrcode>${hee(uri)}</u2-qrcode>
        <p>${hee(labels.byHand)} <code>${hee(secret)}</code></p>
        <p><input name=label placeholder="${hee(labels.name)}"></p>
        <p><input name=code inputmode=numeric autocomplete=one-time-code pattern="[0-9]{6}" maxlength=6 placeholder="${hee(labels.code)}" required></p>
        <button>${hee(labels.confirm)}</button>
        <button type=button data-cancel>${hee(labels.cancel)}</button>
      </form>`;
      setup.hidden = false;
      start.hidden = true;
      setup.querySelector("[name=code]").focus();
    } catch (e) { show(e?.message || String(e)); }
  });

  const close = () => {
    setup.innerHTML = "";
    setup.hidden = true;
    start.hidden = false;
  };

  setup.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.target;
    show();
    try {
      await totp.enrol.verify.post({ code: form.elements.code.value.trim(), label: form.elements.label.value.trim() });
      close();
      show(labels.done);
      await load();
    } catch (e) { show(e?.message || String(e)); }
  });

  setup.addEventListener("click", (event) => {
    if (event.target.closest("[data-cancel]")) close();
  });

  list.addEventListener("click", async (event) => {
    const row = event.target.closest("[data-app]");
    if (!row || !event.target.closest("[data-delete]")) return;
    if (!confirm(labels.delConfirm)) return;
    show();
    try {
      await totp(row.dataset.app).delete();
      await load();
    } catch (e) { show(e?.message || String(e)); }
  });

  load();
});
