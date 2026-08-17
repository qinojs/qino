import { WebAuthn } from "@qino/m/auth.webauthn/pub/webauthn.js";
import { t } from "@qino/pub/qino.js";

cms.initNode("cont.webauthn", (el) => {
  const { apiBase, redirectUrl } = el.dataset;
  const wa = new WebAuthn({ apiBase });
  const msg = el.querySelector(".-msg");

  el.querySelector("[data-action=login]")?.addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    const prev = btn.textContent;
    btn.textContent = await t`Signing in…`;
    try {
      wa.abortConditional();
      const result = await wa.login({ email: el.querySelector("[data-email]")?.value });
      if (result.ok) {
        redirectUrl ? (location.href = redirectUrl) : location.reload();
      } else {
        msg.value = await t`Login failed: ${result.error ?? "unknown"}`;
      }
    } catch (err) {
      msg.value = err.message;
    } finally {
      btn.disabled = false;
      btn.textContent = prev;
    }
  });

  wa.loginConditional().then((r) => { if (r?.ok) location.reload(); }).catch(console.error);
});
