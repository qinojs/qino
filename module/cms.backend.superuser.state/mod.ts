// deno-lint-ignore-file no-explicit-any
import { backend } from "../cms.backend/mod.ts";
import type { Node } from "../cms/lib/Node.ts";
import { getCtx } from "../core/lib/RequestContext.ts";
import { hee } from "../core/lib/util.ts";
import { dump } from "../../deps.ts";

export const name = "cms.backend.superuser.state";
export const needs = ["cms.backend"];

export async function install({ app }: any): Promise<void> {
  const P = await backend.install(app, "cms.backend.superuser.state");
  if (P) {
    await P.title("en", "Server State");
    await P.title("de", "Server State");
  }
}

async function render(node: Node): Promise<string> {
  const ctx = getCtx() as any;
  if (!await ctx.user?.get?.("superuser")) return "<div></div>";

  const stateHtml = await renderState(node);

  return `<div>
  <div class="c1-box" style="flex:0 0 auto">
    <div class="-head">State</div>
    <div class="-body" style="flex:1 1 100%; xdisplay:flex; gap:8px; align-items:start; flex-wrap:wrap">
      <button type=button onclick="cms.reloadPart(${Number(node.id)}, 'state')">neu laden</button>
    </div>
  </div>
  <div class="beBoxCont" cms-part="state">${stateHtml}</div>
</div>`;
}

async function renderState(node: Node): Promise<string> {
  const ctx = getCtx() as any;
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
  return `<div class="c1-box" style="min-width:0; overflow:auto">
  <div class="-head">${hee(title)}</div>
  <div class="-body" style="overflow:auto; max-height:90vh">${html}</div>
</div>`;
}

function safeRender(value: unknown): string | undefined {
  if (typeof value !== "function") return undefined;
  return `<function>function <b>${hee((value as any).name ?? "")}</b>(${hee((value as any).length)})</function>`;
}

export const cms = {
  node: {
    render,
    parts: {
      state: renderState,
    },
  },
};
