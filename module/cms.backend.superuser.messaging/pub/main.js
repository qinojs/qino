import { api } from "@qino/pub/qino.js";

cms.initNode("backend.superuser.messaging", (el) => {
  const nid = Number(cms.el.nid(el));
  const node = api.cms.node(nid);
  const filter = el.querySelector("[data-filter]");
  let timer;
  filter?.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      const vars = Object.fromEntries(new FormData(filter));
      const url = new URL(location);
      for (const key of ["search", "channel"]) vars[key] ? url.searchParams.set(key, vars[key]) : url.searchParams.delete(key);
      history.replaceState(null, "", url);
      cms.reloadPart(nid, "list", vars);
    }, 250);
  });

  const scroll = el.querySelector(".-scroll");
  if (scroll) scroll.scrollTop = scroll.scrollHeight;
  let busy = false;

  el.addEventListener("submit", async (event) => {
    const form = event.target;
    if (!form.matches(".-composer")) return;
    event.preventDefault();
    if (busy) return;
    const button = form.querySelector("[data-reply]");
    busy = true;
    button.disabled = true;
    try {
      const response = await node.api.post({
        reply: {
          usr: form.elements.usr.value,
          channel: form.elements.channel.value,
          text: form.elements.text.value.trim(),
          format: form.elements.format.value,
        },
      });
      await (await import("@qino/u2/js/dialog/dialog.js")).alert(response?.message || "");
      if (response?.ok) location.reload();
    } catch (e) {
      await (await import("@qino/u2/js/dialog/dialog.js")).alert(e?.message || String(e));
    } finally {
      busy = false;
      button.disabled = false;
    }
  });
});
