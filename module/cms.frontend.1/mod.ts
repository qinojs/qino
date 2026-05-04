/**
 * cms.frontend.1/mod.ts - Frontend-1-Modul Hooks
 * Port of cms.frontend.1/qg.php
 */

import "./serverInterface.ts";
import { hee } from "../core/lib/util.ts"
import { getCtx } from "../core/lib/context.ts";
import type { App } from "../core/server.ts";
import type { Node } from "../cms/lib/Node.ts";
import type { Tree } from "../core/lib/apt.ts";
import { AccessError } from "../core/lib/apt.ts";
import { s } from "../core/lib/schema.ts";
import { allowSettingsEditorAssets } from "../core/lib/settings.ts";

export const name = "cms.frontend.1";
export const needs = ["cms"];

export const settingsSchema = {
  properties: {
    "show urls": {
      type: "boolean",
      description: "Blendet im Einstellungsbereich der Seite den URL-Abschnitt ein.",
    },
    "show access.time": {
      type: "boolean",
      description: "Blendet im Einstellungsbereich der Seite das Zeitfenster fur den Zugriff ein.",
    },
  },
};

export const ctxSettingsSchema = {
  properties: {
    custom: {
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

async function renderWidget(ctx: any, widget: string, params: Record<string, any> = {}): Promise<string | null | false> {
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

export const api: Tree = {
  widget: {
    ":widget": {
      post: {
        description: "CMS-Frontend-Widget rendern.",
        input: s.object({ params: s.optional(s.record()) }),
        execute: ({ widget, params }: any, ctx: any) =>
          renderWidget(ctx, widget, params ?? {}),
      },
    },
  },
};

/** Widget-Inhalt rendern */
export async function cmsFrontend1Widget(
  widget: string,
  open: boolean,
  node: Node,
  cls = "-content",
  param: Record<string, any> = {},
): Promise<string> {
  let inner = "";
  if (open) {
    const mod = await import(widgetUrl(widget));
    inner = String(await mod.default?.(node, { param }) ?? "");
  }
  return `<div class="${cls}" widget=${widget}>${inner}</div>`;
}

/** Widget als Accordion */
export async function cmsFrontend1WidgetAccordion(
  widget: string,
  node: Node,
  title: string | null = null,
  param: Record<string, any> = {},
): Promise<string> {
  const ctx = getCtx();

  const open = !!await ctx.settings["cms.frontend.1"].custom.widget[widget];
  const cls = "-widgetHead " + (open ? "-open" : "");

  let headHtml: string;
  try {
    headHtml = await cmsFrontend1Widget(widget + ".head", true, node, cls, param);
  } catch {
    headHtml = `<div class="${cls}"><span class=-title>${
      title ?? widget
    }</span></div>`;
  }
  const contentHtml = await cmsFrontend1Widget(widget, open, node, "-content", param);
  return headHtml + contentHtml;
}

/** Widget als Sidebar-Item */
export async function cmsFrontend1WidgetSidebar(widget: string, node: Node, title: string, tooltip = ""): Promise<string> {
  const ctx = getCtx();
  const sidebarV = await ctx.settings["cms.frontend.1"].custom.sidebar;
  const open = sidebarV === widget;
  const content = await cmsFrontend1Widget(widget, open, node);
  return `<div class="-item ${open ? "-open" : ""}" itemid="${widget}">
  ${content}
  <div class=-title>
    <div class=-text title="${hee(tooltip)}" c1-tooltip>${title}</div>
  </div>
</div>`;
}

export function init(app: App) {
  app.aptTree["cms.frontend.1"] = api;

  app.on("cms-ready", async ({ ctx }) => {
    if (ctx.get.qgCmsNoFrontend) return;
    if (await app.settings.cms.frontend !== "cms.frontend.1") return;

    const g = ctx.state;
    const settings = ctx.settings;

    const node = app.cms.MainNode;
    if (!node) return;
    const access = await node.access();
    const inBackend = node.vs?.module === "cms.layout.backend";

    if (access > 1 || inBackend) {
      const pageNotFound = await app.settings.cms.pageNotFound ?? 0;
      if (pageNotFound != node.id) {
        const lastKey = inBackend ? "last_backend_page" : "last_frontend_page";
        const otherKey = inBackend ? "last_frontend_page" : "last_backend_page";
        settings.cms[lastKey] = ctx.server.REQUEST_URI;
        const toggleUrl = await settings.cms[otherKey] ?? "";
        g.js_data = g.js_data ?? {};
        g.js_data.cmsBackendUrl = toggleUrl;
        ctx.html.addJSFile(ctx.sysURL + "cms.frontend.1/pub/js/init.js");
      }
    }

    if (access > 1) {
      g.csp = g.csp ?? {};
      g.csp["img-src"] = g.csp["img-src"] ?? {};
      g.csp["img-src"]["blob:"] = true;
      g.js_data = g.js_data ?? {};
      g.js_data.Page = node.id;
      g.js_data.qgCmsRequestedPage = app.cms.RequestedNode?.id;
      g.js_data.qgDebugmode = (await ctx.user.get?.("superuser"))
        ? "debug"
        : null;
      g.js_data.qgCmsEditmode = g.editmode;

      if (g.editmode) {
        g.js_data.cmsClipboard = parseInt(String(await settings.cms.clipboard ?? "0"));
        const panel = await import(new URL("./view/panel.ts", import.meta.url).href);
        await app.languages.nsStart("cms");
        const panelHtml = String(await panel.default?.(node, {}) ?? "");
        await app.languages.nsStop();
        ctx.html.prependContent(panelHtml);
      }
    }

    if (access < 2) return;
    ctx.html.addJSFile(ctx.sysURL + "core/js/c1.js");
    ctx.html.addJSFile(ctx.sysURL + "core/js/c1/dom.js");
    ctx.html.addCSSFile(ctx.sysURL + "cms.frontend.1/pub/css/off.css");

    const editmode = access > 1 && parseInt(await settings.cms.editmode);
    if (editmode) {
      ctx.html.addJSFile(ctx.sysURL + "cms.frontend.1/pub/js/browserCheck.js");
      ctx.html.addJSFile(ctx.sysURL + "core/js/qg.js");
      ctx.html.addJSFile(ctx.sysURL + "core/js/c1/onElement.js");
      ctx.html.addJSFile(ctx.sysURL + "cms/pub/js/cms.js");
      ctx.html.addJSFile(ctx.sysURL + "core/js/jQuery.js");
      ctx.html.addJSFile(ctx.sysURL + "core/js/jQuery/ui.js");
      ctx.html.addJSFile(ctx.sysURL + "core/js/jQuery/fn/dynatree.js");
      ctx.html.addJSM(ctx.sysURL + "cms.frontend.1/pub/js/frontend.mjs");
      allowSettingsEditorAssets(ctx);
      ctx.html.addJSM(ctx.sysURL + "cms.frontend.1/pub/js/panel.mjs");
      ctx.html.addCSSFile(ctx.sysURL + "core/js/Rte/main.css");
      ctx.html.addCSSFile(ctx.sysURL + "core/js/jQuery/fn/dynatree/skin-vista/ui.dynatree.css");
      ctx.html.addCSSFile(ctx.sysURL + "core/css/q1Rst.css");
      ctx.html.addCSSFile(ctx.sysURL + "core/css/c1/box.css");
      ctx.html.addCSSFile(ctx.sysURL + "cms.frontend.1/pub/css/main.css");
      ctx.html.addCSSFile(ctx.sysURL + "cms.frontend.1/pub/css/panel.css");
      ctx.html.addCSSFile(ctx.sysURL + "cms.frontend.1/pub/css/tree.css");
    }
  });
}
