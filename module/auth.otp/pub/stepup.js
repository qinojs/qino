// Step-up with a code sent over one of the user's channels. One handler for all of them: the
// factor's name is the channel's name.
import { proveForm } from "@qino/pub/stepUpDialog.js";
import { api, t } from "@qino/pub/qino.js";

export async function prove(root, factor) {
  const otp = api["auth.otp"](factor.name);
  const { form, done } = await proveForm(
    root,
    `<button type=button data-send>${await t`Send code`}</button>
    <label>${await t`Code`} <input name=code inputmode=numeric autocomplete=one-time-code pattern="[0-9]{6}" maxlength=6 required></label>`,
    async (form) => (await otp.verify.post({ code: form.elements.code.value.trim() })).ok,
  );
  const out = form.querySelector("output");

  // Android reads the code out of the sms itself; everywhere else the keyboard offers it through
  // autocomplete. Enhancement only — the field stays typeable if this does nothing.
  const abort = new AbortController();
  root.closest("dialog")?.addEventListener("close", () => abort.abort(), { once: true });
  done.then(() => abort.abort());
  const readSms = () => {
    if (factor.name !== "sms" || !("OTPCredential" in globalThis)) return;
    navigator.credentials.get({ otp: { transport: ["sms"] }, signal: abort.signal })
      .then((sms) => {
        if (!sms?.code) return;
        form.elements.code.value = sms.code;
        form.requestSubmit();
      })
      .catch(() => {}); // aborted, declined, or the message never arrived here
  };

  form.querySelector("[data-send]").addEventListener("click", async (event) => {
    event.target.disabled = true;
    try {
      await otp.post();
      out.value = await t`Code sent.`;
      form.elements.code.focus();
      readSms();
    } catch (e) {
      out.value = e?.message || String(e);
    }
    event.target.disabled = false;
  });

  return done;
}
