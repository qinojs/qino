cms.initCont("cms.backend.module.git", (el) => {
  const installUrl = el.querySelector("#git-install-url");
  const installOut = el.querySelector("#git-install-out");
  const installBtn = el.querySelector("#git-install-btn");

  if (installBtn) {
    installBtn.addEventListener("click", async () => {
      const url = installUrl.value.trim();
      if (!url) return;
      installOut.style.display = "block";
      installOut.textContent = "Installing...";
      installOut.style.color = "#555";
      try {
        const r = await fetch("/api/git/install", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ gitUrl: url }) });
        const d = await r.json();
        if (!r.ok) throw new Error(d.error ?? r.statusText);
        installOut.textContent = "Installed: " + d.installed + "\nPath: " + d.path;
        installOut.style.color = "#2a7";
      } catch (e) {
        installOut.textContent = "Error: " + e.message;
        installOut.style.color = "#c33";
      }
    });
  }

  el.addEventListener("click", async (e) => {
    const pullBtn = e.target.closest("[data-git-action]");
    if (pullBtn) {
      const action = pullBtn.dataset.gitAction;
      const mod = pullBtn.dataset.gitMod;
      const out = el.querySelector("#git-out-" + mod);
      out.style.display = "block";
      out.style.color = "#555";
      out.textContent = action + "...";
      try {
        const r = await fetch("/api/git/" + action, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ module: mod }) });
        const d = await r.json();
        if (!r.ok) throw new Error(d.error ?? r.statusText);
        out.textContent = d.output || "OK";
        out.style.color = "#2a7";
      } catch (e) {
        out.textContent = "Error: " + e.message;
        out.style.color = "#c33";
      }
    }

    const checkoutBtn = e.target.closest("[data-git-checkout]");
    if (checkoutBtn) {
      const mod = checkoutBtn.dataset.gitCheckout;
      const sel = el.querySelector("#git-ref-" + mod);
      const ref = sel.value;
      if (!ref) return;
      if (!confirm("Switch to " + ref + "?")) return;
      const out = el.querySelector("#git-out-" + mod);
      out.style.display = "block";
      out.style.color = "#555";
      out.textContent = "checkout " + ref + "...";
      try {
        const r = await fetch("/api/git/checkout", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ module: mod, ref }) });
        const d = await r.json();
        if (!r.ok) throw new Error(d.error ?? r.statusText);
        out.textContent = d.output || "OK";
        out.style.color = "#2a7";
      } catch (e) {
        out.textContent = "Error: " + e.message;
        out.style.color = "#c33";
      }
    }
  });
});
