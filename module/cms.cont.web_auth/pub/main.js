cms.initCont("cms.cont.web_auth", async (el) => {
  const login = el.querySelector(".web-auth-login");
  const manage = el.querySelector(".web-auth-manage");
  const root = login || manage;
  if (!root) return;

  const { scriptUrl, tUrl, apiBase, redirectUrl } = root.dataset;
  const { initWebAuth, WebAuth } = await import(scriptUrl);
  const { t } = await import(tUrl);

  if (login) {
    initWebAuth({
      apiBase,
      onSuccess: () => { redirectUrl ? (location.href = redirectUrl) : location.reload(); },
      onError: async (_, r) => { login.querySelector(".-msg").value = await t`Login failed: ${r.error ?? "unknown"}`; },
    });
  }

  if (manage) {
    const wa = new WebAuth({ apiBase });

    const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const fmt = ts => new Date(ts * 1000).toLocaleDateString();

    async function loadList() {
      const list = manage.querySelector("[data-list]");
      if (!list) return;
      try {
        const creds = await wa.listCredentials();
        list.innerHTML = creds.length
          ? creds.map(c => `<div data-web-auth-credential>
              <strong>${esc(c.name)}</strong>
              <small>${fmt(c.created)} · ${fmt(c.lastUsed)}</small>
              <button data-web-auth-action="delete" data-web-auth-cred-id="${c.id}">🗑</button>
            </div>`).join("")
          : await t`No passkeys registered.`;
      } catch { list.textContent = await t`Error loading.`; }
    }

    loadList();

    initWebAuth({
      apiBase,
      onSuccess: (action) => {
        if (action === "register") {
          manage.querySelector("[data-web-auth-name]").value = "";
          loadList();
        }
      },
      onError: async (_, r) => { manage.querySelector(".-msg").value = r.error ?? await t`Error`; },
    });
  }
});
