import { backend } from "../cms.backend/mod.ts";
import { getCtx, hee, html, type HtmlString, type App } from "../core/mod.ts";
import { dump, $item } from "../../deps.ts";
import type { Node } from "../cms/mod.ts";

export const name = "cms.backend.superuser.state";
export const needs = ["cms.backend"];

const dumpJs = "https://jsr.io/@nuxodin/dump/1.5.2/mod.js";

export async function install({ app }: { app: App }): Promise<void> {
  await backend.install(app, "cms.backend.superuser.state", { en: "Server State", de: "Server-Status" });
}

function render(node: Node): HtmlString {
  return html`<div class=u2-flex>
  <div class="u2-card" style="flex:1 1 100%">
    <div class="-head">State</div>
    <div class="-body" style="flex:1 1 100%; xdisplay:flex; gap:8px; align-items:start; flex-wrap:wrap">
      <button type=button onclick="cms.reloadPart(${Number(node.id)}, 'state')">neu laden</button>
    </div>
  </div>
  <div class="u2-flex" cms-part="state">${renderState(node)}</div>
</div>`;
}

function renderState(node: Node): HtmlString {
  const ctx = getCtx();
  ctx.res.html.scripts.add(ctx.req.modulePath + "cms.backend.superuser.state/pub/state.mjs");
  ctx.res.html.importMap.set(dumpJs, dumpJs); // ugly
  ctx.res.csp["script-src"]["https://jsr.io/@nuxodin/"] = true;
  return html`
    ${dumpBox("Server / app", node.app, 2)}
    ${dumpBox("Context", ctx, 2)}
    ${clientCtxBox("Client / ctx (qino.js)")}`;
}

// empty box, filled client-side by pub/state.mjs with dump(getCtx())
function clientCtxBox(title: string): HtmlString {
  return html`<div class="u2-card" style="min-width:0; overflow:auto; height:80vh">
  <div class="-head">${title}</div>
  <div class="-body" id="qg-client-ctx" style="overflow:auto; max-height:90vh"><em>lädt…</em></div>
</div>`;
}

function dumpBox(title: string, value: unknown, depth: number): HtmlString {
  let out = "";
  try {
    out = dump(value, {
      depth,
      inherited: true,
      symbols: true,
      callGetters: true,
      order: false,
      customRender: safeRender,
    });
  } catch (err) {
    out = `<pre>${hee(err instanceof Error ? err.stack ?? err.message : String(err))}</pre>`;
  }
  return html`<div class="u2-card" style="min-width:0; overflow:auto; height:80vh">
  <div class="-head">${title}</div>
  <div class="-body" style="overflow:auto; max-height:90vh">${html.raw(out)}</div>
</div>`;
}

function safeRender(value: unknown): string | undefined {
  if (typeof value !== "function") return;
  if ((value as unknown as Record<symbol, unknown>)[$item]) return `<em>[item.js proxy]</em>`; // don't read .name/.length → no autoviv
  return `<function>function <b>${hee(value.name ?? "")}</b>(${hee(value.length)})</function>`;
}

export function backendDashboardWidget(app: App): Promise<HtmlString> {
  const rss = Deno.memoryUsage().rss;
  const upSec = Math.floor(performance.now() / 1000);
  const h = Math.floor(upSec / 3600), m = Math.floor((upSec % 3600) / 60);
  return html.async`<div class=-body>
    <b><u2-bytes>${rss}</u2-bytes></b> ${app.t`memory`}<br>
    <small>${app.t`uptime`} ${h}h ${m}m</small>
  </div>`;
}

export const cms = {
  node: {
    render,
    parts: {
      state: renderState,
    },
  },
};
