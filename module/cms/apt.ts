// deno-lint-ignore-file no-explicit-any
/**
 * cms/apt.ts — apt Action-Tree für das cms-Modul.
 * Vollständige Portierung aller Routen aus apt-exports.ts.
 */

import { s } from "../core/lib/StandardSchema.ts";
import { AccessError, ConflictError, NotFoundError } from "../core/lib/apt.ts";
import { getCtx } from "../core/lib/RequestContext.ts";
import { $item } from "../../deps.ts";
import { readSettings } from "../core/lib/settings.ts";
import {
  cmsGetTree,
  cmsRequestUsed,
  cmsSearchFiles,
  cmsSearchNodes,
  filesSetOrder,
  nodeFileAdd,
  nodeRemove,
  nodeToJson,
} from "./apt-exports.ts";

// ───── Helpers ────────────────────────────────────────────────────────────

async function slimTree(node: any): Promise<any> {
  const title = String(await (await node.title()).string() ?? "").trim();
  const children = [
    ...((await node.children({ type: "p" })) ?? new Map()).values(),
  ];
  const entry: any = { id: parseInt(String(node.id)), title: title || "-" };
  const childNodes = [];
  for (const child of children) {
    if ((await child.access()) >= 1) childNodes.push(await slimTree(child));
  }
  if (childNodes.length) entry.children = childNodes;
  return entry;
}

async function contentBlocks(node: any): Promise<any[]> {
  const contents = [
    ...((await node.children({ type: "c" })) ?? new Map()).values(),
  ];
  const entries = [];
  for (const content of contents) {
    if ((await content.access()) < 1) continue;
    const title = String(await (await content.title()).string() ?? "").trim();
    const entry: any = {
      id: parseInt(String(content.id)),
      module: String(content.vs?.module ?? ""),
      name: String(content.vs?.name ?? ""),
    };
    if (title) entry.title = title;
    const children = await contentBlocks(content);
    if (children.length) entry.children = children;
    entries.push(entry);
  }
  return entries;
}

// ───── Node ───────────────────────────────────────────────────────────────

const node = {
  paramSchema: s.number().describe("Node-ID"),

  resolve: async (id: number) => {
    const app = getCtx().app;
    const n = await app.cms.node(id);
    if (!n.is()) throw new NotFoundError(`Node ${id} not found`);
    if ((await n.access()) < 1) throw new AccessError();
    return n;
  },

  get: {
    description: "Read node as JSON",
    execute: ({ node }: any) => nodeToJson(node.id),
  },

  delete: {
    description: "Delete node (may go to trash)",
    execute: async ({ node }: any) => {
      if ((await node.access()) < 2) throw new AccessError();
      return nodeRemove(node);
    },
  },

  sitemap: {
    get: {
      description: "Read page tree from this node (id and title only)",
      execute: ({ node }: any) => slimTree(node),
    },
  },

  tree: {
    get: {
      description: "Read page tree from this node",
      input: s.object({
        filter: s.optional(s.string()).describe("Type filter, e.g. \"p\" for pages, \"*\" for all"),
        level: s.optional(s.number()).describe("Max depth (0 = unlimited)"),
      }),
      execute: ({ node, filter, level }: any) =>
        cmsGetTree(node.id, { filter: filter ?? "*", level: level ?? 0 }),
    },
  },

  html: {
    get: {
      description: "Render node as HTML",
      input: s.object({ vars: s.optional(s.record()) }),
      execute: ({ node, vars }: any) => node.html(vars ?? {}),
    },
    post: {
      description: "Render node as HTML (vars as JSON body)",
      input: s.object({ vars: s.optional(s.any()) }),
      execute: ({ node, vars }: any) => node.html(vars ?? {}),
    },
    part: {
      ":part": {
        paramSchema: s.string(),
        get: {
          description: "Render a specific HTML part of the node",
          input: s.object({ vars: s.optional(s.record()) }),
          execute: ({ node, part, vars }: any) =>
            node.htmlPart(part, vars ?? {}),
        },
      },
    },
  },

  name: {
    put: {
      description: "Set the internal name of the page",
      input: s.object({ value: s.string() }),
      execute: async ({ node, value }: any) => {
        if ((await node.access()) < 2) throw new AccessError();
        await node.set("name", value);
        return { ok: true };
      },
    },
  },

  title: {
    put: {
      description: "Set page title (language-specific)",
      input: s.object({ value: s.string(), lang: s.optional(s.string()).describe("Language code, e.g. \"de\". Default: current language.") }),
      output: s.object({ changed: s.boolean() }),
      execute: async ({ node, value, lang }: any) => {
        if ((await node.access()) < 2) throw new AccessError();
        const changed = await node.title(lang ?? getCtx().lang, value);
        return { changed: changed !== false };
      },
    },
  },

  text: {
    ":name": {
      paramSchema: s.string().describe("Text field name"),
      put: {
        description: "Set a text field of the page (language-specific)",
        input: s.object({ value: s.string(), lang: s.optional(s.string()).describe("Language code, e.g. \"de\". Default: current language.") }),
        output: s.object({ changed: s.boolean() }),
        execute: async ({ node, name, value, lang }: any) => {
          if ((await node.access()) < 2) throw new AccessError();
          const changed = await node.text(name, lang ?? getCtx().lang, value);
          return { changed: changed !== false };
        },
      },
    },
  },

  visible: {
    put: {
      description: "Set navigation visibility",
      input: s.object({ value: s.boolean() }),
      execute: async ({ node, value }: any) => {
        if ((await node.access()) < 2) throw new AccessError();
        await node.set("visible", value ? 1 : 0);
        return { ok: true };
      },
    },
  },

  searchable: {
    put: {
      description: "Set page searchability",
      input: s.object({ value: s.boolean() }),
      execute: async ({ node, value }: any) => {
        if ((await node.access()) < 2) throw new AccessError();
        await node.set("searchable", value ? 1 : 0);
        return { ok: true };
      },
    },
  },

  module: {
    put: {
      description: "Set the layout module of the page",
      input: s.object({
        module: s.string().describe("Module name, e.g. \"cms.default\""),
        recursive: s.boolean().default(false).describe("If true, apply to all sub-pages too"),
      }),
      execute: async ({ node, module, recursive }: any) => {
        if ((await node.access()) < 2) throw new AccessError();
        const ctx = getCtx();
        const access = await (ctx.app as any).db.one(
          "SELECT access FROM module WHERE name = ?",
          [module],
        );
        if (!access && !(await ctx.user?.get("superuser"))) {
          throw new AccessError();
        }
        if (!recursive) {
          await node.set("module", module);
          return { ok: true };
        }
        let done = 0, has = 0;
        const bough = await node.bough({ type: "p" }) ?? new Map();
        for (const P of bough.values()) {
          has++;
          if ((await P.access()) < 2) continue;
          await P.set("module", module);
          done++;
        }
        return { done, has };
      },
    },
  },

  "online-start": {
    put: {
      description: "Set online-start time (ISO string or Unix timestamp)",
      input: s.object({ value: s.optional(s.string()).describe("ISO string (\"2024-01-01T00:00:00\") or Unix timestamp. Omit to remove limit.") }),
      execute: async ({ node, value }: any) => {
        if ((await node.access()) < 2) throw new AccessError();
        let v = value;
        if (typeof v === "string" && v.includes("T")) {
          v = Math.floor(new Date(v).getTime() / 1000);
        }
        await node.set("online_start", v);
        return { ok: true };
      },
    },
  },

  "online-end": {
    put: {
      description: "Set online-end time (ISO string or Unix timestamp)",
      input: s.object({ value: s.optional(s.string()).describe("ISO string (\"2024-12-31T23:59:59\") or Unix timestamp. Omit to remove limit.") }),
      execute: async ({ node, value }: any) => {
        if ((await node.access()) < 2) throw new AccessError();
        let v = value;
        if (typeof v === "string" && v.includes("T")) {
          v = Math.floor(new Date(v).getTime() / 1000);
        }
        await node.set("online_end", v);
        return { ok: true };
      },
    },
  },

  children: {
    post: {
      description: "Create a new child page",
      input: s.object({ title: s.string() }),
      execute: async ({ node, title }: any) => {
        if ((await node.access()) < 2) throw new AccessError();
        const ctx = getCtx();
        const id = await node.createChild();
        if (!id) throw new Error("createChild failed");
        const child = await (ctx.app as any).cms.node(id);
        await child.title(ctx.lang, title);
        await child.changeUser(ctx.user, 3);
        return nodeToJson(id);
      },
    },
  },

  copy: {
    post: {
      description: "Copy page/content",
      input: s.object({ deep: s.boolean().default(false).describe("If true, sub-pages are copied too") }),
      output: s.object({ id: s.string() }),
      execute: async ({ node, deep }: any) => {
        if ((await node.access()) < 2) throw new AccessError();
        const ctx = getCtx();
        const copied = await node.copy(deep, async (cp: any) => {
          if ((await cp.access()) < 1) return false;
        });
        if (!copied) throw new AccessError();
        await copied.changeUser(ctx.user, 3);
        const titleStr = String(await (await copied.title()).string() ?? "")
          .trim();
        await copied.title(ctx.lang, titleStr ? titleStr + " (copy)" : "");
        return { id: String(copied.id) };
      },
    },
  },

  insertBefore: {
    put: {
      description: "Move a node into this node",
      input: s.object({
        id: s.string().describe("ID of the node to move"),
        before: s.optional(s.string()).describe("Insert before this node-ID. Omit to append."),
      }),
      execute: async ({ node, id, before }: any) => {
        const Child = await getCtx().app.cms.node(id);
        if ((await Child.access()) < 2) throw new AccessError();
        if ((await node.access()) < 2) throw new AccessError("no access on target");
        if (await node.in(Child)) {
          throw new ConflictError("would create a loop");
        }
        await node.insertBefore(Child, before);
        return { ok: true };
      },
    },
  },

  contents: {
    get: {
      description: "Read content blocks of this page (id, module, name, children)",
      execute: ({ node }: any) => contentBlocks(node),
    },

    post: {
      description: "Create a new content block",
      input: s.object({ module: s.string().describe("Module name, e.g. \"cms.text\"") }),
      execute: async ({ node, module }: any) => {
        if ((await node.access()) < 2) throw new AccessError();
        const ctx = getCtx();
        const cont = await node.createCont({ module });
        if (!cont) throw new Error("createCont failed");
        await cont.changeUser(ctx.user, 3);
        return { id: cont.id, html: await cont.html() };
      },
    },
  },

  defaults: {
    put: {
      description: "Set default settings of the page",
      input: s.object({ value: s.optional(s.record()) }),
      execute: async ({ node, value }: any) => {
        if ((await node.access()) < 2) throw new AccessError();
        await (await node.SET)?.setDefault(value);
        return { ok: true };
      },
    },
  },

  access: {
    put: {
      description: "Set public access level of the page",
      input: s.object({ value: s.optional(s.number()).describe("Access level (0 = private, 1 = public). Omit to reset.") }),
      execute: async ({ node, value }: any) => {
        if ((await node.access()) < 3) throw new AccessError();
        await node.set("access", value == null ? null : parseInt(value));
        await node.changeUser(getCtx().user, 3);
        return { public: !!value };
      },
    },

    users: {
      ":user": {
        paramSchema: s.number(),
        put: {
          description: "Set a user's access level on this page",
          input: s.object({
            access: s.number().describe("Access level (1=read, 2=write, 3=admin, 0=revoke)"),
            recursive: s.boolean().default(false).describe("Apply to all sub-pages too"),
          }),
          execute: async ({ node, user, access, recursive }: any) => {
            if ((await node.access()) < 3) throw new AccessError();
            await node.changeUser(user, access);
            if (!recursive) return { ok: true };
            let done = 0, has = 0;
            const bough = await node.bough({ type: "p" }) ?? new Map();
            for (const P of bough.values()) {
              has++;
              if ((await P.access()) < 3) continue;
              await P.changeUser(user, access);
              done++;
            }
            return { done, has };
          },
        },
      },
    },

    groups: {
      ":group": {
        paramSchema: s.number(),
        put: {
          description: "Set a group's access level on this page",
          input: s.object({ access: s.number().describe("Access level (1=read, 2=write, 3=admin, 0=revoke)") }),
          execute: async ({ node, group, access }: any) => {
            if ((await node.access()) < 3) throw new AccessError();
            await node.changeGroup(group, access);
            return { ok: true };
          },
        },
      },
    },
  },

  files: {
    get: {
      description: "List all files of the page",
      execute: ({ node }: any) => node.files().then((f: any) => f ?? {}),
    },

    post: {
      description: "Add a file to the page",
      input: s.object({
        file: s.optional(s.string()).describe("Filename to add (from upload or server path)"),
        replace: s.optional(s.string()).describe("Existing filename to replace"),
      }),
      execute: async ({ node, file, replace }: any) => {
        if ((await node.access()) < 2) throw new AccessError();
        return nodeFileAdd(node, file, replace);
      },
    },

    put: {
      description: "Manually set file order (array of filenames)",
      input: s.object({ sort: s.array(s.string()) }),
      execute: async ({ node, sort }: any) => {
        if ((await node.access()) < 2) throw new AccessError();
        await node.sortFiles(sort);
        return { ok: true };
      },
    },

    doubles: {
      delete: {
        description: "Delete duplicate files (same MD5)",
        execute: async ({ node }: any) => {
          if ((await node.access()) < 2) throw new AccessError();
          const files = await node.files();
          const seen: Record<string, boolean> = {};
          for (const [name, F] of Object.entries(files ?? {})) {
            const md5 = (F as any).vs?.["md5"];
            if (md5 && seen[md5]) await node.deleteFile(name);
            if (md5) seen[md5] = true;
          }
          return { ok: true };
        },
      },
    },

    all: {
      delete: {
        description: "Delete all files of the page",
        execute: async ({ node }: any) => {
          if ((await node.access()) < 2) throw new AccessError();
          for (const name of Object.keys(await node.files() ?? {})) {
            await node.deleteFile(name);
          }
          return { ok: true };
        },
      },
    },

    order: {
      post: {
        description: "Sort files by criterion",
        input: s.object({ by: s.string().describe("Sort criterion: \"name\", \"name_reverse\", \"date\", \"sort\"") }),
        execute: async ({ node, by }: any) => {
          if ((await node.access()) < 2) throw new AccessError();
          await filesSetOrder(node, by);
          return { ok: true };
        },
      },
    },

    ":file": {
      paramSchema: s.string().describe("Filename"),
      delete: {
        description: "Delete a file from the page",
        execute: async ({ node, file }: any) => {
          if ((await node.access()) < 2) throw new AccessError();
          return node.deleteFile(file);
        },
      },
    },
  },

  urls: {
    ":lang": {
      paramSchema: s.string().describe("Language code, e.g. \"de\""),
      put: {
        description: "Set custom URL for a language",
        input: s.object({ url: s.string() }),
        execute: async ({ node, lang, url }: any) => {
          if ((await node.access()) < 2) throw new AccessError();
          await node.urlSet(lang, { url, custom: 1 });
          return node.urlSeoGen(lang);
        },
      },

      custom: {
        delete: {
          description: "Remove custom URL for a language (restores SEO URL)",
          execute: async ({ node, lang }: any) => {
            if ((await node.access()) < 2) throw new AccessError();
            await node.urlSet(lang, { custom: 0 });
            return node.urlSeoGen(lang);
          },
        },
      },

      target: {
        put: {
          description: "Set URL target for a language",
          input: s.object({ value: s.optional(s.string()).describe("Link target, e.g. \"_blank\". Omit to reset.") }),
          execute: async ({ node, lang, value }: any) => {
            if ((await node.access()) < 2) throw new AccessError();
            await node.urlSet(lang, { target: value });
            return { ok: true };
          },
        },
      },
    },
  },

  redirects: {
    post: {
      description: "Add a redirect URL",
      input: s.object({ url: s.string() }),
      execute: async ({ node, url }: any) => {
        if ((await node.access()) < 2) throw new AccessError();
        if (await cmsRequestUsed(url)) throw new Error("URL already in use");
        await (getCtx().app as any).db.query(
          "INSERT INTO page_redirect SET request = ?, redirect = ?",
          [url, node.id],
        );
        return { ok: true };
      },
    },

    delete: {
      description: "Remove a redirect URL",
      input: s.object({ url: s.string() }),
      execute: async ({ node, url }: any) => {
        if ((await node.access()) < 2) throw new AccessError();
        await (getCtx().app as any).db.query(
          "DELETE FROM page_redirect WHERE request = ? AND redirect = ?",
          [url, node.id],
        );
        return { ok: true };
      },
    },
  },

  settings: {
    get: {
      description: "Read page settings. Optional sub-path via path param",
      input: s.object({ path: s.optional(s.array(s.string())).describe("Sub-path within settings, e.g. [\"theme\", \"color\"]") }),
      execute: ({ node, path }: any) => {
        const item = node.settings[$item].sub(path ?? []);
        return readSettings(item);
      },
    },
    put: {
      description: "Set page settings",
      input: s.object({
        path: s.optional(s.array(s.string())).describe("Sub-path within settings, e.g. [\"theme\", \"color\"]"),
        value: s.any().describe("Value to set (any JSON type)"),
      }),
      execute: async ({ node, path, value }: any) => {
        if ((await node.access()) < 2) throw new AccessError();
        node.settings[$item].sub(path ?? []).set(value);
        return { ok: true };
      },
    },
    delete: {
      description: "Delete page settings at given path",
      input: s.object({ path: s.array(s.string()).describe("Sub-path to delete, e.g. [\"theme\", \"color\"]") }),
      execute: async ({ node, path }: any) => {
        if ((await node.access()) < 2) throw new AccessError();
        if (!path?.length) {
          throw new ConflictError("Cannot delete page settings root");
        }
        await node.settings[$item].sub(path).remove();
        return { ok: true };
      },
    },
  },

  "settings-schema": {
    get: {
      description: "Read page settings schema. Optional sub-path via path param",
      input: s.object({ path: s.optional(s.array(s.string())).describe("Sub-path within settings schema") }),
      execute: ({ node, path }: any) => {
        return node.settings[$item].sub(path ?? []).schema ?? {};
      },
    },
  },

  api: {
    post: {
      description: "Call module-specific page API",
      execute: async ({ node, ...vars }: any) => {
        try {
          const pageApi = node.module?.cms?.node?.pageApi;
          return typeof pageApi === "function" ? await pageApi(node, vars) ?? null : null;
        } catch (e: any) {
          if (!e?.message?.includes("Module not found")) throw e;
          return null;
        }
      },
    },
  },
};

// ───── Top-Level-API ──────────────────────────────────────────────────────

export const api = {
  tree: {
    get: {
      description: "Read the full page tree",
      input: s.object({
        filter: s.optional(s.string()).describe("Type filter, e.g. \"p\" for pages, \"*\" for all"),
        level: s.optional(s.number()).describe("Max depth (0 = unlimited)"),
      }),
      execute: ({ filter, level }: any) =>
        cmsGetTree(0, { filter: filter ?? "*", level: level ?? 0 }),
    },
  },

  nodes: {
    get: {
      description: "Search nodes by title",
      input: s.object({ q: s.string().describe("Search query") }),
      execute: ({ q }: any) => cmsSearchNodes(q),
    },
  },

  files: {
    get: {
      description: "Search files",
      input: s.object({ q: s.string().describe("Search query") }),
      execute: ({ q }: any) => cmsSearchFiles(q),
    },
  },

  clipboard: {
    put: {
      description: "Set clipboard node (cut)",
      input: s.object({ value: s.optional(s.number()).describe("Node-ID to cut. Omit to clear clipboard.") }),
      execute: async ({ value }: any) => {
        const ctx = getCtx();
        if (value) {
          const P = await (ctx.app as any).cms.node(value);
          if ((await P.access()) < 2) throw new AccessError();
        }
        ctx.settings.cms.clipboard(parseInt(value ?? ''));
        return { ok: true };
      },
    },
  },

  "request-used": {
    get: {
      description: "Check if a URL is already used as a redirect",
      input: s.object({ url: s.string() }),
      execute: ({ url }: any) => cmsRequestUsed(url).then((used) => ({ used })),
    },
  },

  "node-id-from-txt-id": {
    get: {
      description: "Get node ID from a text ID (title or text field)",
      input: s.object({ id: s.number() }),
      execute: async ({ id }: any) => {
        const db = (getCtx().app as any).db;
        const pid = await db.one(
          "SELECT page_id FROM page_text WHERE text_id = ?",
          [id],
        );
        if (pid) return { id: pid };
        const pid2 = await db.one("SELECT id FROM page WHERE title_id = ?", [
          id,
        ]);
        if (pid2) return { id: pid2 };
        throw new NotFoundError(`no page for text_id ${id}`);
      },
    },
  },

  txt: {
    ":id": {
      paramSchema: s.number().describe("Text-ID"),
      put: {
        description: "Set text or title by text ID (inline editor)",
        input: s.object({ value: s.string(), lang: s.optional(s.string()).describe("Language code, e.g. \"de\". Default: current language") }),
        execute: async ({ id, value, lang }: any) => {
          const ctx = getCtx();
          const db = (ctx.app as any).db;
          const lang_ = lang ?? ctx.lang;
          const row = await db.row(
            "SELECT name, page_id FROM page_text WHERE text_id = ?",
            [id],
          );
          if (row) {
            const n = await (ctx.app as any).cms.node(row.page_id);
            if (!n.is()) throw new NotFoundError();
            if ((await n.access()) < 2) throw new AccessError();
            const changed = await n.text(row.name, lang_, value);
            return { changed: changed !== false, kind: "text" };
          }
          const pid = await db.one("SELECT id FROM page WHERE title_id = ?", [
            id,
          ]);
          if (pid) {
            const n = await (ctx.app as any).cms.node(pid);
            if (!n.is()) throw new NotFoundError();
            if ((await n.access()) < 2) throw new AccessError();
            const changed = await n.title(lang_, value);
            return { changed: changed !== false, kind: "title" };
          }
          throw new NotFoundError(`no node for text_id ${id}`);
        },
      },
    },
  },

  node: {
    ":node": node,
  },
};
