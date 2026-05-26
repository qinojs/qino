import { backend } from "../cms.backend/mod.ts";
import type { Node } from "../cms/lib/Node.ts";
import { getCtx } from "../core/lib/RequestContext.ts";
import { hee } from "../core/lib/util.ts";
import { dump } from "../../deps.ts";
import type { App } from "@qino/qino";

export const name = "cms.backend.superuser.state";
export const needs = ["cms.backend"];

export async function install({ app }: { app: App }): Promise<void> {
  const P = await backend.install(app, "cms.backend.superuser.state");
  if (P) {
    await P.title("en", "Server State");
  }
}

async function render(node: Node): Promise<string> {
  const ctx = getCtx();
  if (!await ctx.user?.get?.("superuser")) return "<div></div>";

  const stateHtml = await renderState(node);

  return `<div class=u2-flex>
  <div class="u2-card" style="flex:1 1 100%">
    <div class="-head">State</div>
    <div class="-body" style="flex:1 1 100%; xdisplay:flex; gap:8px; align-items:start; flex-wrap:wrap">
      <button type=button onclick="cms.reloadPart(${Number(node.id)}, 'state')">neu laden</button>
    </div>
  </div>
  <div class="u2-flex" cms-part="state">${stateHtml}</div>
</div>`;
}

async function renderState(node: Node): Promise<string> {
  const ctx = getCtx();
  if (!await ctx.user?.get?.("superuser")) return "<div></div>";
  return `
    ${dumpBox("Server / app", node.app, 2)}
    ${dumpBox("Context", ctx, 3)}`;
}

function dumpBox(title: string, value: unknown, depth: number): string {
  let html = "";
  try {
    html = dump(value, {
      depth,
      inherited: true,
      symbols: true,
      callGetters: true,
      order: false,
      customRender: safeRender,
    });
  } catch (err) {
    html = `<pre>${hee(err instanceof Error ? err.stack ?? err.message : String(err))}</pre>`;
  }
  return `<div class="u2-card" style="min-width:0; overflow:auto; height:80vh">
  <div class="-head">${hee(title)}</div>
  <div class="-body" style="overflow:auto; max-height:90vh">${html}</div>
</div>`;
}

function safeRender(value: unknown): string | undefined {
  if (typeof value !== "function") return undefined;
  return `<function>function <b>${hee(value.name ?? "")}</b>(${hee(value.length)})</function>`;
}

export const cms = {
  node: {
    render,
    parts: {
      state: renderState,
    },
  },
};
