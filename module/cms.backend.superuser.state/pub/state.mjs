// dump des client-seitigen ctx aus qino.js — zum vergleich mit den server-boxen.
// gleiche dump()-lib wie serverseitig (jsr:@nuxodin/dump), gleiche optionen.
import { getCtx } from "../../core/pub/js/qino.js";
import { dump } from "https://esm.sh/jsr/@nuxodin/dump@1.5.2";

const mount = document.getElementById("qg-client-ctx");
if (mount) {
  const safeRender = (value) =>
    typeof value === "function"
      ? `<function>function <b>${value.name ?? ""}</b>(${value.length})</function>`
      : undefined;
  try {
    mount.innerHTML = dump(getCtx(), {
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
