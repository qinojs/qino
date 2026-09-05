import { Access, AccessError, s } from "@qino/qino";
import { cms, cmsCtx } from "@qino/qino/cms";

import { widgetUrl } from "./view/widget.ts";

import type { Ctx, ApiTree, App } from "@qino/qino";

type WidgetParams = Record<string, unknown> & { pid?: number };
type WidgetInput = { widget: string; params?: WidgetParams };

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

async function renderWidget(ctx: Ctx, widget: string, params: WidgetParams = {}): Promise<string | null> {
  const page = await cms(ctx.app).node(params.pid);
  if (await page.access() < 2) throw new AccessError();
  if (widget.includes("/")) return null;
  ctx.state.cmsWidgetCont = page;
  await ctx.app.languages.nsStart("cms");
  const mod = await import(widgetUrl(widget));
  const html = String(await mod.default?.(page, { param: params }) ?? "");
  ctx.app.languages.nsStop();
  return html;
}

export const api: ApiTree = {
  widget: {
    ":widget": {
      post: {
        description: "Render CMS frontend widget.",
        access: Access.USER,
        input: s.object({ params: s.optional(s.record()) }),
        execute: ({ widget, params }: WidgetInput, ctx: Ctx) =>
          renderWidget(ctx, widget, params ?? {}),
      },
    },
  },
};

export function init(app: App, { signal }: { signal: AbortSignal }) {
  app.on("cms:page-ready", async ({ ctx }) => {
    if (ctx.req.query.cms_noFrontend || await app.settings.cms.frontend !== "cms.frontend.2") return;

    const settings = ctx.settings;

    const node = cmsCtx(ctx).mainNode;
    if (!node) return;
    const access = await node.access();
    const inBackend = node.vs?.module === "cms.layout.backend";

    const html = ctx.res.html;
    const moduleUrl = ctx.req.moduleUrl;
    const qino = html.jsData.qino ??= {};

    if (access > 1 || inBackend) {
      const pageNotFound = await app.settings.cms.pageNotFound ?? 0;
      if (pageNotFound != node.id) {
        const lastKey = inBackend ? "last_backend_page" : "last_frontend_page";
        const otherKey = inBackend ? "last_frontend_page" : "last_backend_page";
        const url = ctx.req.url;
        settings.cms[lastKey](url.pathname.slice(ctx.req.appUrl.length) + url.search);
        (qino.cms ??= {}).beUrl = String(settings.cms[otherKey]() ?? "");
        html.scripts.add(moduleUrl + "cms.frontend.2/pub/js/init.js");
      }
    }

    if (access > 1) {
      ctx.res.csp["img-src"]["blob:"] = true;
      qino.cms ??= {};
      qino.cms.nodeId = node.id;
      qino.cms.requestedNodeId = cmsCtx(ctx).requestedNodeId;
      qino.dev = ctx.dev;
      qino.cms.editmode = cmsCtx(ctx).editmode;

      if (cmsCtx(ctx).editmode) {
        qino.cms.clipboard = Number(settings.cms.clipboard() ?? "0");
        const panel = await import(new URL("./view/panel.ts", import.meta.url).href);
        app.languages.nsStart("cms");
        const panelHtml = String(await panel.default?.(node, {}) ?? "");
        app.languages.nsStop();
        html.content += panelHtml;
      }
    }

    if (access < 2) return;
    html.scripts.add(moduleUrl + "core/pub/js/c1.js");

    const editmode = access > 1 && Number(settings.cms.editmode());
    if (editmode) {

      html.scripts.add(moduleUrl + "cms/pub/js/cms.mjs");
      html.styles.add(moduleUrl + "cms.frontend.2/pub/Rte/main.css");
      html.styles.add(moduleUrl + "cms/pub/css/ui.css");
      html.styles.add(moduleUrl + "cms.frontend.2/pub/css/icons.css");

      html.styles.add(moduleUrl + "cms.frontend.2/pub/inline/page.css");
      html.scripts.add(moduleUrl + "cms.frontend.2/pub/inline/inline.js");
      html.scripts.add(moduleUrl + "cms.frontend.2/pub/panel/panel.js");
    }
  }, { signal });
}
