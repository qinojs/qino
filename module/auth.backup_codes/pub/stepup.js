// Step-up by spending one backup code.
import { api, t } from "@qino/pub/qino.js";

export async function prove(root) {
  root.innerHTML = `<form>
    <label>${await t`Backup code`} <input name=code autocomplete=off required></label>
    <button>${await t`Confirm`}</button>
    <output></output>
  </form>`;
  const form = root.querySelector("form");
  form.elements.code.focus();
  return await new Promise((resolve) => {
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      try {
        const { ok } = await api["auth.backup_codes"].verify.post({ code: form.elements.code.value.trim() });
        if (ok) return resolve(true);
        form.querySelector("output").value = await t`That counted for nothing here.`;
      } catch (e) {
        form.querySelector("output").value = e?.message || String(e);
      }
    });
  });
}
