import { api, hee, t } from "@qino/pub/qino.js";

const codes = api["auth.backup_codes"];

cms.initNode("cont.my.backup_codes", async (el) => {
  const state = el.querySelector("[data-state]");
  const shown = el.querySelector("[data-codes]");
  const button = el.querySelector("[data-generate]");
  const msg = el.querySelector(".-msg");
  const labels = {
    none: await t`You have no backup codes.`,
    create: await t`Create backup codes`,
    replace: await t`Replace with a fresh set`,
    replaceConfirm: await t`A fresh set makes your current codes worthless. Continue?`,
    once: await t`Keep these somewhere safe — they are shown this once and never again.`,
    copy: await t`Copy`,
    copied: await t`Copied.`,
    error: await t`Error loading.`,
  };
  const remaining = (n) => t`${n} backup codes left.`;

  const show = (value = "") => void (msg.value = value);
  let left = 0;

  const load = async () => {
    try {
      ({ left } = await codes.get());
      state.textContent = left ? await remaining(left) : labels.none;
      button.textContent = left ? labels.replace : labels.create;
      button.hidden = false;
    } catch (e) {
      state.textContent = labels.error;
      button.hidden = true;
      show(e?.message || String(e));
    }
  };

  button.addEventListener("click", async () => {
    if (left && !confirm(labels.replaceConfirm)) return;
    show();
    try {
      const fresh = (await codes.generate.post()).codes;
      shown.innerHTML = `<p>${hee(labels.once)}</p>
        <ul>${fresh.map((code) => `<li><code>${hee(code)}</code>`).join("")}</ul>
        <button type=button data-copy>${hee(labels.copy)}</button>`;
      shown.hidden = false;
      shown.querySelector("[data-copy]").addEventListener("click", async () => {
        await navigator.clipboard.writeText(fresh.join("\n"));
        show(labels.copied);
      });
      await load();
    } catch (e) { show(e?.message || String(e)); }
  });

  load();
});
