// Step-up with a code from the authenticator app.
import { api, t } from "@qino/pub/qino.js";

export async function prove(root) {
  root.innerHTML = `<form>
    <label>${await t`6-digit code`} <input inputmode=numeric autocomplete=one-time-code pattern="[0-9]{6}" maxlength=6 name=code required></label>
    <button>${await t`Confirm`}</button>
    <output></output>
  </form>`;
  const form = root.querySelector("form");
  form.elements.code.focus();
  return await new Promise((resolve) => {
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      try {
        const { ok } = await api["auth.totp"].verify.post({ code: form.elements.code.value.trim() });
        if (ok) return resolve(true);
        form.querySelector("output").value = await t`That counted for nothing here.`;
      } catch (e) {
        form.querySelector("output").value = e?.message || String(e);
      }
    });
  });
}
