// Step-up with a code from the authenticator app.
import { proveForm } from "@qino/pub/stepUpDialog.js";
import { api, t } from "@qino/pub/qino.js";

export async function prove(root) {
  const { done } = await proveForm(
    root,
    `<label>${await t`6-digit code`} <input name=code inputmode=numeric autocomplete=one-time-code pattern="[0-9]{6}" maxlength=6 required></label>`,
    async (form) => (await api["auth.totp"].verify.post({ code: form.elements.code.value.trim() })).ok,
  );
  return done;
}
