// Step-up with the password. Core's own factor, so core's own handler.
import { api, t } from "./js/qino.js";

export async function prove(root) {
  root.innerHTML = `<form>
    <label>${await t`Password`} <input type=password name=pw autocomplete=current-password required></label>
    <button>${await t`Confirm`}</button>
    <output></output>
  </form>`;
  const form = root.querySelector("form");
  return await new Promise((resolve) => {
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      try {
        await api.core.password.verify.post({ pw: form.elements.pw.value });
        resolve(true);
      } catch (e) {
        form.querySelector("output").value = e?.message || String(e);
      }
    });
  });
}
