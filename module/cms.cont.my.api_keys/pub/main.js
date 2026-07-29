import { apt } from "../../core/pub/js/qino.js";
import { t } from "../../core/pub/js/qino.js";

const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
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
      const keys = await apt.api_key.keys.get();
      list.innerHTML = keys.length
        ? keys.map((k) => `<div data-key>
            <code>${esc(k.prefix)}…</code> <strong>${esc(k.name)}</strong>
            <small>${fmt(k.created)}${k.expires ? ` · ${labels.expires} ${fmt(k.expires)}` : ""}</small>
            <button data-del="${k.id}"><u2-ico icon=delete>✕</u2-ico></button>
          </div>`).join("")
        : esc(labels.empty);
    } catch { list.textContent = await t`Error loading.`; }
  };

  list.addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-del]");
    if (!btn) return;
    if (!confirm(labels.del)) return;
    const r = await apt.api_key.key(btn.dataset.del).delete();
    if (r.ok) btn.closest("[data-key]")?.remove();
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      const r = await apt.api_key.keys.post({ name: name.value || undefined });
      token.hidden = false;
      token.value = `${await t`Copy now — shown only once`}: ${r.token}`;
      name.value = "";
      await load();
    } catch (err) { msg.value = err.message; }
  });

  load();
});
