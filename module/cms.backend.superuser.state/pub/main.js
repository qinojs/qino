// dump of the client-side ctx from qino.js — to compare against the server boxes.
// same dump() lib as on the server (jsr:@nuxodin/dump), served from its git tag for the browser.
import { ctx } from "@qino/pub/qino.js";
import { html } from "@qino/pub/html.js";
import { dump } from "https://cdn.jsdelivr.net/gh/nuxodin/dump.js@v1.5.2/mod.js";

const safeRender = (value) =>
  typeof value === "function"
    ? String(html`<function>function <b>${value.name}</b>(${value.length})</function>`)
    : undefined;

cms.initNode("backend.superuser.state", (el) => {
  // the box lives in the reloadable part, so it is filled again after every reload
  const fill = () => {
    const mount = el.querySelector("[data-client-ctx]");
    if (!mount) return;
    try {
      mount.innerHTML = dump(ctx, { depth: 2, inherited: true, symbols: true, callGetters: true, order: false, customRender: safeRender });
    } catch (err) {
      mount.innerHTML = html`<pre>${err?.stack ?? err}</pre>`;
    }
  };

  el.querySelector("[data-reload]")?.addEventListener("click", async () => {
    await cms.reloadPart(Number(cms.el.nid(el)), "state");
    fill();
  });

  fill();
});
