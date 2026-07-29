// dump of the client-side ctx from qino.js — to compare against the server boxes.
// same dump() lib as on the server (jsr:@nuxodin/dump), same options.
import { ctx } from "../../core/pub/js/qino.js";
import { dump } from "https://jsr.io/@nuxodin/dump/1.5.2/mod.js";

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
