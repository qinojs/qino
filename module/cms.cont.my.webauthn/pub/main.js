import { WebAuthn } from "@qino/m/auth.webauthn/pub/webauthn.js";
import { hee, t } from "@qino/pub/qino.js";

const fmt = (ts) => ts ? new Date(ts * 1000).toLocaleDateString() : "";

cms.initNode("cont.my.webauthn", async (el) => {
  const wa = new WebAuthn({ apiBase: el.dataset.apiBase });
  const list = el.querySelector("[data-keys]");
  const name = el.querySelector("[data-name]");
  const add = el.querySelector("[data-add]");
  const msg = el.querySelector(".-msg");
  const labels = {
    added: await t`Added`,
    lastUsed: await t`Last used`,
    never: await t`Never used`,
    unnamed: await t`Passkey`,
    del: await t`Remove`,
    delConfirm: await t`Remove this passkey?`,
    empty: await t`No passkeys yet.`,
    adding: await t`Registering…`,
    error: await t`Error loading.`,
  };

  const show = (value = "") => void (msg.value = value);

  const load = async () => {
    try {
      const keys = await wa.listCredentials();
      list.innerHTML = keys.length
        ? keys.map((key) => `<div data-key="${key.id}">
            <p><strong>${hee(key.name || labels.unnamed)}</strong>
              <small>${hee(labels.added)} ${hee(fmt(key.created))} ·
                ${key.lastUsed ? `${hee(labels.lastUsed)} ${hee(fmt(key.lastUsed))}` : hee(labels.never)}</small></p>
            <button type=button data-delete>${hee(labels.del)}</button>
          </div>`).join("")
        : hee(labels.empty);
    } catch (e) {
      list.textContent = labels.error;
      show(e?.message || String(e));
    }
  };

  add.addEventListener("click", async () => {
    const prev = add.textContent;
    add.disabled = true;
    add.textContent = labels.adding;
    show();
    try {
      const result = await wa.register({ name: name.value.trim() || await wa.guessName() });
      if (!result.ok) throw new Error(result.error);
      name.value = "";
      await load();
    } catch (e) {
      show(e?.message || String(e));
    } finally {
      add.disabled = false;
      add.textContent = prev;
    }
  });

  list.addEventListener("click", async (event) => {
    const row = event.target.closest("[data-key]");
    if (!row || !event.target.closest("[data-delete]")) return;
    if (!confirm(labels.delConfirm)) return;
    show();
    try {
      const result = await wa.deleteCredential(row.dataset.key);
      if (!result.ok) throw new Error(result.error);
      await load();
    } catch (e) { show(e?.message || String(e)); }
  });

  load();
});
