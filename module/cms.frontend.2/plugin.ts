import { Access, AccessError, s, type RequestContext, type AptTree, type App } from "../core/mod.ts";
import type {} from "../cms/mod.ts";

export const name = "cms.frontend.2";
export const needs = ["cms"];

export const settingsSchema = {
  properties: {
    "show urls": {
      type: "boolean",
      description: "Shows the URL section in the page settings area.",
    },
    "show access.time": {
      type: "boolean",
      description: "Shows the access time window in the page settings area.",
    },
  },
};

export const ctxSettingsSchema = {
  properties: {
    tour_seen: { type: "boolean" },
    ui: {
      properties: {
        widget: { additionalProperties: { type: "boolean" } },
        sidebar: { type: "string" },
        tree_show_c: { type: "boolean" },
      },
    },
  },
};

function widgetUrl(widget: string): string {
  return new URL("./view/widgets/" + widget + ".ts", import.meta.url).href;
}

async function renderWidget(ctx: RequestContext, widget: string, params: Record<string, any> = {}): Promise<string | null | false> {
  const P = await ctx.app.cms.node(params["pid"]);
  if (await P.access() < 2) throw new AccessError();
  if (widget.includes("/")) return null;
  ctx.state.cmsWidgetCont = P;
  await ctx.app.languages.nsStart("cms");
  const mod = await import(widgetUrl(widget));
  const html = String(await mod.default?.(P, { param: params }) ?? "");
  ctx.app.languages.nsStop();
  return html;
}

export const api: AptTree = {
  widget: {
    ":widget": {
      post: {
        description: "Render CMS frontend widget.",
        access: Access.USER,
        input: s.object({ params: s.optional(s.record()) }),
        execute: ({ widget, params }: any, ctx: RequestContext) =>
          renderWidget(ctx, widget, params ?? {}),
      },
    },
  },
};

export function init(app: App) {
  app.on("cms-ready", async e => {
    const ctx = e.ctx as RequestContext;
    if (ctx.get.qgCmsNoFrontend) return;
    if (await app.settings.cms.frontend !== "cms.frontend.2") return;

    const settings = ctx.settings;

    const node = ctx.cms.mainNode;
    if (!node) return;
    const access = await node.access();
    const inBackend = node.vs?.module === "cms.layout.backend";

    const qino = ctx.html.jsData.qino ??= {};

    if (access > 1 || inBackend) {
      const pageNotFound = await app.settings.cms.pageNotFound ?? 0;
      if (pageNotFound != node.id) {
        const lastKey = inBackend ? "last_backend_page" : "last_frontend_page";
        const otherKey = inBackend ? "last_frontend_page" : "last_backend_page";
        settings.cms[lastKey](ctx.requestUri.slice(ctx.appURL.length));
        (qino.cms ??= {}).beUrl = String(settings.cms[otherKey]() ?? "");
        ctx.html.scripts.add(ctx.sysURL + "cms.frontend.2/pub/js/init.mjs");
      }
    }

    if (access > 1) {
      ctx.csp["img-src"]["blob:"] = true;
      qino.cms ??= {};
      qino.cms.nodeId = node.id;
      qino.cms.requestedNodeId = ctx.cms.requestedNodeId;
      if (await ctx.user?.get("superuser")) qino.dev = ctx.dev || null;
      qino.cms.editmode = ctx.cms.editmode;

      if (ctx.cms.editmode) {
        qino.cms.clipboard = Number(settings.cms.clipboard() ?? "0");
        const panel = await import(new URL("./view/panel.ts", import.meta.url).href);
        app.languages.nsStart("cms");
        const panelHtml = String(await panel.default?.(node, {}) ?? "");
        app.languages.nsStop();
        ctx.html.content += panelHtml;
      }
    }

    if (access < 2) return;
    ctx.html.legacyScripts.add(ctx.sysURL + "core/pub/js/c1.js");
    ctx.html.styles.add(ctx.sysURL + "cms.frontend.2/pub/css/off.css");

    const editmode = access > 1 && Number(settings.cms.editmode());
    if (editmode) {
      ctx.html.scripts.add(ctx.sysURL + "cms/pub/js/cms.mjs");
      ctx.html.scripts.add(ctx.sysURL + "cms.frontend.2/pub/js/frontend.mjs");
      ctx.html.scripts.add(ctx.sysURL + "cms.frontend.2/pub/js/panel.mjs");
      ctx.html.styles.add(ctx.sysURL + "core/pub/js/Rte/main.css");
      ctx.html.styles.add(ctx.sysURL + "cms/pub/css/ui.css");
      ctx.html.styles.add(ctx.sysURL + "cms.frontend.2/pub/css/inline.css");
    }
  });
}
