// Step-up with a passkey. The authenticator is the whole dialog, so this only starts it.
import { ctx, t } from "@qino/pub/qino.js";

import { WebAuthn } from "./webauthn.js";

export async function prove(root) {
  root.innerHTML = `<button type=button>${await t`Use passkey`}</button><output></output>`;
  const button = root.querySelector("button");
  return await new Promise((resolve) => {
    button.addEventListener("click", async () => {
      button.disabled = true;
      try {
        const result = await new WebAuthn({ apiBase: ctx.appUrl + "api/auth.webauthn" }).confirm();
        if (result.ok) return resolve(true);
        root.querySelector("output").value = result.error ?? await t`That did not work.`;
      } catch (e) {
        root.querySelector("output").value = e?.message || String(e);
      }
      button.disabled = false;
    });
  });
}
