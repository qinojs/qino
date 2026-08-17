// Step-up with the password. Core's own factor, so core's own handler.
import { proveForm } from "./js/stepUpDialog.js";
import { api, t } from "./js/qino.js";

export async function prove(root) {
  const { done } = await proveForm(
    root,
    `<label>${await t`Password`} <input type=password name=pw autocomplete=current-password required></label>`,
    async (form) => (await api.core.password.verify.post({ pw: form.elements.pw.value })).ok,
  );
  return done;
}
