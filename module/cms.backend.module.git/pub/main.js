import { apt } from "../../core/pub/js/qino.js";

const confirm = async (text) => (await import("@qino/u2/js/dialog/dialog.js")).confirm(text);

const set = (out, text, state) => { out.textContent = text; out.dataset.state = state ?? ""; };

const run = async (out, pending, fn) => {
  set(out, pending, "");
  try { set(out, await fn(), "ok"); }
  catch (e) { set(out, "Error: " + e.message, "err"); }
};

cms.initNode("backend.module.git", (el) => {
  const installOut = el.querySelector("#git-install-out");
  const installBtn = el.querySelector("#git-install-btn");

  installBtn?.addEventListener("click", () => {
    const url = el.querySelector("#git-install-url").value.trim();
    if (!url) return;
    run(installOut, "Installing...", async () => {
      const d = await apt.git.install.post({ gitUrl: url });
      return "Installed: " + d.installed + "\nPath: " + d.path;
    });
  });

  el.addEventListener("click", async (e) => {
    const actionBtn = e.target.closest("[data-git-action]");
    if (actionBtn) {
      const { gitAction: action, gitMod: mod } = actionBtn.dataset;
      run(el.querySelector("#git-out-" + mod), action + "...", async () =>
        (await apt.git[action].post({ module: mod })).output || "OK");
    }

    const checkoutBtn = e.target.closest("[data-git-checkout]");
    if (checkoutBtn) {
      const mod = checkoutBtn.dataset.gitCheckout;
      const ref = el.querySelector("#git-ref-" + mod).value;
      if (!ref || !await confirm("Switch to " + ref + "?")) return;
      run(el.querySelector("#git-out-" + mod), "checkout " + ref + "...", async () =>
        (await apt.git.checkout.post({ module: mod, ref })).output || "OK");
    }
  });
});
