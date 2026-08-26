import { dirname, isAbsolute, relative, resolve } from "node:path";

import { Access, AccessError, ValidationError, hee, s } from "@qino/qino";
import { cms, cmsCtx } from "@qino/qino/cms";
import { editorUrl } from "@qino/qino/fileEditor";
import { send } from "@qino/qino/messaging.email";

import { widgetUrl } from "./view/widget.ts";

import type { Ctx, ApiTree, App } from "@qino/qino";

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

async function renderWidget(ctx: Ctx, widget: string, params: Record<string, any> = {}): Promise<string | null> {
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

/** Widget modules for a node's settings: the core ones plus whatever its module ships.
  * A module declares one as `cms.node.widget = "pub/settings.js"` in its plugin. */
async function settingsWidgets(ctx: Ctx, pid: number) {
  const node = await cms(ctx.app).node(pid);
  if (await node.access() < 2) throw new AccessError();
  const list = [];
  const own = (name: string) => ({ name, src: ctx.req.moduleUrl + "cms.frontend.4/pub/panel/widgets/" + name + ".js" });
  // A module's own widget fills the "options" slot — same name and title as the server-rendered one,
  // so it keeps its place, its open state and its label whatever module the node holds.
  const mod = node.module as { plugin?: { cms?: { node?: { widget?: string } } }; modUrl?: string } | undefined;
  const modWidget = mod?.plugin?.cms?.node?.widget;
  if (modWidget && mod?.modUrl) list.push({ name: "options", title: await ctx.app.t`Settings`, src: mod.modUrl + modWidget });
  list.push(own("media"));
  if (await ctx.app.settings["cms.frontend.4"]["show access.time"]) list.push(own("access.time"));
  if (await node.access() > 2) list.push(own("access.grp"), own("access.usr"));
  if (node.vs.type === "p") list.push(own("seo"));
  if (await ctx.app.settings["cms.frontend.4"]["show urls"]) list.push(own("urls"));
  // sets and txts hang inside extended, mounted by it
  list.push({ ...own("extended"), context: { superuser: !!ctx.user?.superuser } });
  if (ctx.user?.superuser) list.push(own("superuser"));
  return list; 
}

/* The two file roots behind a node's module: what the site added, and what the module ships. */
const ROOTS = ["data", "app"] as const;

async function moduleRoot(ctx: Ctx, pid: number, scope: string): Promise<string> {
  const node = await cms(ctx.app).node(pid);
  const mod = node.module as { data?: string; dir?: string } | undefined;
  const root = scope === "app" ? mod?.dir : mod?.data;
  if (!root) throw new ValidationError([{ message: "unknown file root", path: ["in"] }]);
  return root;
}

/** Resolve a path inside a root. Anything that escapes it is a bad request, not a file. */
function inRoot(root: string, path: string): string {
  const file = resolve(root, path);
  const rel = relative(resolve(root), file);
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) throw new ValidationError([{ message: "invalid path", path: ["path"] }]);
  return file;
}

async function* walkDir(dir: string): AsyncGenerator<string> {
  const entries = [];
  try {
    for await (const entry of Deno.readDir(dir)) entries.push(entry);
  } catch { return; }
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.isDirectory) yield* walkDir(dir + entry.name + "/");
    else yield dir + entry.name;
  }
}

async function moduleFiles(ctx: Ctx, pid: number) {
  const node = await cms(ctx.app).node(pid);
  const module = String(node.vs.module ?? "");
  const list: Record<string, { path: string; name: string; mtime: number; editor?: string }[]> = {};
  for (const scope of ROOTS) {
    const root = await moduleRoot(ctx, pid, scope);
    const files = [];
    for await (const path of walkDir(root)) {
      const info = await Deno.stat(path).catch(() => null);
      if (!info?.isFile) continue;
      files.push({ path, name: path.slice(root.length), mtime: Number(info.mtime ?? 0), editor: editorUrl(path) });
    }
    list[scope] = files;
  }
  // the module's app settings, if it has any — shown below the files
  return { ...list, settings: module && module in ctx.app.settings ? module : null };
}


/** Feedback from the panel: goes to the address the site configured, answers go to the sender. */
async function sendFeedback(ctx: Ctx, msg: string, link: string) {
  const app = ctx.app;
  const to = String(await app.settings.cms.feedback.email ?? "").trim();
  if (!to) throw new Error("CMS feedback recipient is not configured");
  // where an answer belongs: the verified contact, never the login handle
  const email = await ctx.user?.contact("email") ?? "";
  const data: Record<string, string> = {
    "Message:": msg,
    Link: link,
    Browser: ctx.req.header("user-agent") ?? "",
    "E-Mail:": email,
    Firstname: ctx.user?.given_name ?? "",
    Lastname: ctx.user?.family_name ?? "",
  };
  const body = `<h1>CMS feedback</h1><dl>${Object.entries(data).map(([key, value]) =>
    `<dt><strong>${hee(key)}</strong></dt><dd>${hee(value).replaceAll("\n", "<br>")}</dd>`
  ).join("")}</dl>`;
  let failed = "";
  const sent = await send(app, { email: to }, { title: "CMS feedback", text: body, format: "html", replyTo: email }, {
    onError: (message: string) => failed ||= message, // send() reports the reason here and nowhere else
  });
  if (!sent) throw new Error("CMS feedback could not be sent" + (failed ? ": " + failed : ""));
  ctx.settings.cms.feedback.text(""); // the draft is gone with it
  return { ok: true };
}

export const api: ApiTree = {
  feedback: {
    get: {
      description: "Who is logged in, and where feedback goes.",
      access: Access.USER,
      execute: async (_a: unknown, ctx: Ctx) => ({
        name: [ctx.user?.given_name, ctx.user?.family_name].filter(Boolean).join(" "),
        email: String(await ctx.app.settings.cms.feedback.email ?? ""),
      }),
    },
    post: {
      description: "Send panel feedback by email.",
      access: Access.USER,
      input: s.object({ msg: s.string(), link: s.optional(s.string()) }),
      execute: ({ msg, link }: any, ctx: Ctx) => sendFeedback(ctx, msg, link ?? ""),
    },
  },
  files: {
    ":pid": {
      paramSchema: s.number(),
      get: {
        description: "Files of the node module's two roots, plus the module's app settings name.",
        access: Access.SUPERUSER,
        execute: ({ pid }: any, ctx: Ctx) => moduleFiles(ctx, Number(pid)),
      },
      post: {
        description: "Create an empty file in one of the roots.",
        access: Access.SUPERUSER,
        input: s.object({ in: s.string(), path: s.string() }),
        execute: async ({ pid, in: scope, path }: any, ctx: Ctx) => {
          const file = inRoot(await moduleRoot(ctx, Number(pid), scope), path);
          await Deno.mkdir(dirname(file), { recursive: true }).catch(() => {});
          await Deno.writeTextFile(file, "");
          return { ok: true };
        },
      },
      delete: {
        description: "Delete a file from one of the roots.",
        access: Access.SUPERUSER,
        input: s.object({ in: s.string(), path: s.string() }),
        execute: async ({ pid, in: scope, path }: any, ctx: Ctx) => {
          await Deno.remove(inRoot(await moduleRoot(ctx, Number(pid), scope), path)).catch(() => {});
          return { ok: true };
        },
      },
    },
  },
  widgets: {
    ":pid": {
      get: {
        description: "Widget module urls for the settings of a node, in display order.",
        access: Access.USER,
        execute: ({ pid }: any, ctx: Ctx) => settingsWidgets(ctx, Number(pid)),
      },
    },
  },
  widget: {
    ":widget": {
      post: {
        description: "Render CMS frontend widget.",
        access: Access.USER,
        input: s.object({ params: s.optional(s.record()) }),
        execute: ({ widget, params }: any, ctx: Ctx) =>
          renderWidget(ctx, widget, params ?? {}),
      },
    },
  },
};

export function init(app: App, { signal }: { signal: AbortSignal }) {
  app.on("cms:page-ready", async ({ ctx }) => {
    if (ctx.req.query.cms_noFrontend || await app.settings.cms.frontend !== "cms.frontend.4") return;

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
        html.scripts.add(moduleUrl + "cms.frontend.4/pub/js/init.js");
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
    html.legacyScripts.add(moduleUrl + "core/pub/js/c1.js");

    const editmode = access > 1 && Number(settings.cms.editmode());
    if (editmode) {

      html.scripts.add(moduleUrl + "cms/pub/js/cms.mjs");
      html.styles.add(moduleUrl + "core/pub/js/Rte/main.css");
      html.styles.add(moduleUrl + "cms/pub/css/ui.css");

      html.styles.add(moduleUrl + "cms.frontend.4/pub/inline/page.css");
      html.scripts.add(moduleUrl + "cms.frontend.4/pub/inline/inline.js");
      html.scripts.add(moduleUrl + "cms.frontend.4/pub/panel/panel.js");
    }
  }, { signal });
}
