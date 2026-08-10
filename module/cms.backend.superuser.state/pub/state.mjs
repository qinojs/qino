// dump of the client-side ctx from qino.js — to compare against the server boxes.
// same dump() lib as on the server (jsr:@nuxodin/dump), served from its git tag for the browser.
import { ctx } from "@qino/pub/qino.js";
import { dump } from "https://cdn.jsdelivr.net/gh/nuxodin/dump.js@v1.5.2/mod.js";

const mount = document.getElementById("qg-client-ctx");
if (mount) {
  const safeRender = (value) =>
    typeof value === "function"
      ? `<function>function <b>${value.name ?? ""}</b>(${value.length})</function>`
      : undefined;
  try {
    mount.innerHTML = dump(ctx, {
      depth: 2,
      inherited: true,
      symbols: true,
      callGetters: true,
      order: false,
      customRender: safeRender,
    });
  } catch (err) {
    mount.innerHTML = `<pre>${err?.stack ?? err}</pre>`;
  }
}
