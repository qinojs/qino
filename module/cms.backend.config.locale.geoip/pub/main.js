import { api } from "@qino/pub/api.js";

cms.initNode("backend.config.locale.geoip", (el) => {
  const nid = Number(cms.el.nid(el));
  const node = api.cms.node(nid);

  el.addEventListener("change", (e) => {
    const source = e.target.closest("select.-source");
    if (source) node.api.post({ source: source.value }).then(() => cms.reloadNode(nid));
  });

  // The name in the page's language; "—" for an address no range knows.
  el.addEventListener("submit", async (e) => {
    const form = e.target.closest("form.-test");
    if (!form) return;
    e.preventDefault();
    const { country } = await node.api.post({ ip: form.ip.value });
    const lang = document.documentElement.lang || navigator.language;
    form.querySelector("output").value = country
      ? `${new Intl.DisplayNames([lang], { type: "region" }).of(country) ?? country} (${country})`
      : "—";
  });

  el.addEventListener("click", async (e) => {
    const button = e.target.closest("button.-now");
    if (!button) return;
    button.disabled = true;
    const res = await node.api.post({ now: 1 }).catch(() => null);
    button.disabled = false;
    if (res?.error) {
      const { alert } = await import("@qino/u2/js/dialog/dialog.js");
      await alert(res.error);
      return;
    }
    cms.reloadNode(nid);
  });
});
