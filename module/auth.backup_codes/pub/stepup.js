// Step-up by spending one backup code.
import { proveForm } from "@qino/pub/stepUpDialog.js";
import { api } from "@qino/pub/api.js";
import { t } from "@qino/pub/t.js";

export async function prove(root) {
  const { done } = await proveForm(
    root,
    `<label>${await t`Backup code`} <input name=code autocomplete=off required></label>`,
    async (form) => (await api["auth.backup_codes"].verify.post({ code: form.elements.code.value.trim() })).ok,
  );
  return done;
}
