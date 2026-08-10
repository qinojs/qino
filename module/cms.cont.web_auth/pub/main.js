import { WebAuth } from "../../web_auth/pub/web_auth.js";
import { hee, t } from "../../core/pub/js/qino.js";

cms.initNode("cont.web_auth", (el) => {
  const isLogin  = el.classList.contains("web-auth-login");
  const isManage = el.classList.contains("web-auth-manage");
  if (!isLogin && !isManage) return;

  const { apiBase, redirectUrl } = el.dataset;
  const wa = new WebAuth({ apiBase });

  // ── Login ──────────────────────────────────────────────────────────────────

  if (isLogin) {
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
  }

  // ── Manage ─────────────────────────────────────────────────────────────────

  if (isManage) {
    const msg  = el.querySelector(".-msg");
    const list = el.querySelector("[data-list]");

    const loadList = async () => {
      if (!list) return;
      try {
        const creds = await wa.listCredentials();
        const fmt = ts => new Date(ts * 1000).toLocaleDateString();
        list.innerHTML = creds.length
          ? creds.map(c => `<div data-credential>
              <strong>${hee(c.name)}</strong>
              <small>${fmt(c.created)} · ${fmt(c.lastUsed)}</small>
              <button data-action="delete" data-cred-id="${c.id}">🗑</button>
            </div>`).join("")
          : await t`No passkeys registered.`;
        for (const btn of list.querySelectorAll("[data-action=delete]")) {
          btn.addEventListener("click", async () => {
            if (!confirm(await t`Really remove this passkey?`)) return;
            const result = await wa.deleteCredential(btn.dataset.credId);
            if (result.ok) btn.closest("[data-credential]")?.remove();
          });
        }
      } catch { list.textContent = await t`Error loading.`; }
    };

    loadList();

    el.querySelector("[data-action=register]")?.addEventListener("click", async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      const prev = btn.textContent;
      btn.textContent = await t`Registering…`;
      try {
        const name   = el.querySelector("[data-name]")?.value;
        const result = await wa.register({ name: name || await wa.guessName() });
        if (result.ok) {
          el.querySelector("[data-name]").value = "";
          loadList();
        } else {
          msg.value = result.error ?? await t`Error`;
        }
      } catch (err) {
        msg.value = err.message;
      } finally {
        btn.disabled = false;
        btn.textContent = prev;
      }
    });
  }
});
