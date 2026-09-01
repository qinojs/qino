import { WebAuthn } from "@qino/m/auth.webauthn/pub/webauthn.js";
import { stepUp } from "@qino/pub/stepUpDialog.js";
import { t } from "@qino/pub/t.js";

cms.initNode("cont.webauthn", (el) => {
  const { apiBase, redirectUrl } = el.dataset;
  const wa = new WebAuthn({ apiBase });
  const msg = el.querySelector(".-msg");

  const done = () => redirectUrl ? (location.href = redirectUrl) : location.reload();

  /** The passkey was right and a second factor is still owed. */
  const finish = async (factors) => await stepUp({ factors }) && done();

  el.querySelector("[data-action=login]")?.addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    const prev = btn.textContent;
    btn.textContent = await t`Signing in…`;
    try {
      wa.abortConditional();
      const result = await wa.login({ email: el.querySelector("[data-email]")?.value });
      if (result.ok) done();
      else if (result.missing?.length) await finish(result.missing);
      else msg.value = await t`Login failed: ${result.error ?? "unknown"}`;
    } catch (err) {
      msg.value = err.message;
    } finally {
      btn.disabled = false;
      btn.textContent = prev;
    }
  });

  wa.loginConditional().then((r) => {
    if (r?.ok) done();
    else if (r?.missing?.length) finish(r.missing);
  }).catch(console.error);
});
