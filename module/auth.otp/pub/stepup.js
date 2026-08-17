// Step-up with a code sent over one of the user's channels. One handler for all of them: the
// factor's name is the channel's name.
import { api, t } from "@qino/pub/qino.js";

export async function prove(root, factor) {
  const otp = api["auth.otp"](factor.name);
  root.innerHTML = `<form>
    <button type=button data-send>${await t`Send code`}</button>
    <label>${await t`Code`} <input name=code inputmode=numeric autocomplete=one-time-code pattern="[0-9]{6}" maxlength=6 required></label>
    <button>${await t`Confirm`}</button>
    <output></output>
  </form>`;
  const form = root.querySelector("form");
  const out = form.querySelector("output");

  form.querySelector("[data-send]").addEventListener("click", async (event) => {
    event.target.disabled = true;
    try {
      await otp.post();
      out.value = await t`Code sent.`;
      form.elements.code.focus();
    } catch (e) {
      out.value = e?.message || String(e);
    }
    event.target.disabled = false;
  });

  return await new Promise((resolve) => {
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      try {
        const { ok } = await otp.verify.post({ code: form.elements.code.value.trim() });
        if (ok) return resolve(true);
        out.value = await t`That counted for nothing here.`;
      } catch (e) {
        out.value = e?.message || String(e);
      }
    });
  });
}
