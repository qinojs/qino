import { api } from "@qino/pub/api.js";
import { t } from "@qino/pub/t.js";
import { html } from "@qino/pub/html.js";

const apiKeys = api["auth.api_keys"];

const fmt = (ts) => ts ? new Date(ts * 1000).toLocaleDateString() : "–";

cms.initNode("cont.my.api_keys", async (el) => {
  const list  = el.querySelector("[data-list]");
  const form  = el.querySelector("[data-create]");
  const name  = el.querySelector("[data-name]");
  const token = el.querySelector("[data-token]");
  const msg   = el.querySelector(".-msg");

  const labels = { expires: await t`expires`, empty: await t`No keys yet.`, del: await t`Really delete this key?` };

  const load = async () => {
    try {
      const keys = await apiKeys.get();
      list.innerHTML = keys.length
        ? html`${keys.map((k) => html`<div data-key>
            <code>${k.prefix}…</code> <strong>${k.name}</strong>
            <small>${fmt(k.created)}${k.expires ? html` · ${labels.expires} ${fmt(k.expires)}` : ""}</small>
            <button data-del="${k.id}"><u2-ico icon=delete>✕</u2-ico></button>
          </div>`)}`
        : labels.empty;
    } catch { list.textContent = await t`Error loading.`; }
  };

  list.addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-del]");
    if (!btn) return;
    if (!confirm(labels.del)) return;
    const r = await apiKeys(btn.dataset.del).delete();
    if (r.ok) btn.closest("[data-key]")?.remove();
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      const r = await apiKeys.post({ name: name.value || undefined });
      token.hidden = false;
      token.value = `${await t`Copy now — shown only once`}: ${r.token}`;
      name.value = "";
      await load();
    } catch (err) { msg.value = err.message; }
  });

  load();
});
