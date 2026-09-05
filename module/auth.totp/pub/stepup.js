// Step-up with a code from the authenticator app.
import { proveForm } from "@qino/pub/stepUpDialog.js";
import { api } from "@qino/pub/api.js";
import { t } from "@qino/pub/t.js";

export async function prove(root) {
  const { done } = await proveForm(
    root,
    `<label>${await t`6-digit code`} <input name=code inputmode=numeric autocomplete=one-time-code pattern="[0-9]{6}" required></label>`,
    async (form) => (await api["auth.totp"].verify.post({ code: form.elements.code.value })).ok,
  );
  return done;
}
