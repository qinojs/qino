import { apt } from "../../core/pub/js/qino.js";

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
        const d = await apt.git.install.post({ gitUrl: url });
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
        const d = await apt.git[action].post({ module: mod });
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
        const d = await apt.git.checkout.post({ module: mod, ref });
        out.textContent = d.output || "OK";
        out.style.color = "#2a7";
      } catch (e) {
        out.textContent = "Error: " + e.message;
        out.style.color = "#c33";
      }
    }
  });
});
