import { cms } from "./mod.ts";
// deno-lint-ignore-file no-explicit-any

import { s, Access, AccessError, ConflictError, NotFoundError, itemReadDeep, type Ctx } from "../core/mod.ts";
import { $item } from "../../deps.ts";
import * as fns from "./apt-exports.ts";
import type { Node } from "./lib/Node.ts";

// Static gate PUBLIC (a node read is reachable for anyone); the per-call level is checked against the resolved node in guard.
const nodeRead  = { access: Access.PUBLIC, guard: ({ node }: { node: Node }, ctx: Ctx) => node.access(ctx.user).then(a => a >= 1) };
const nodeWrite = { access: Access.PUBLIC, guard: ({ node }: { node: Node }, ctx: Ctx) => node.access(ctx.user).then(a => a >= 2) };
const nodeAdmin = { access: Access.PUBLIC, guard: ({ node }: { node: Node }, ctx: Ctx) => node.access(ctx.user).then(a => a >= 3) };

// Adding/assigning a module needs ADMIN on the module axis (editorial add-gate).
// cms.accessRules lowers e.access to the user's module cap; ADMIN (3) without it.
const requireModuleAdmin = async (module: string, ctx: Ctx): Promise<void> => {
  const e = await ctx.app.fire("module:access", { module, user: ctx.user, access: 3 });
  if (Number(e.access) < 3) throw new AccessError();
};
const settingsPath = s.array(s.string()).describe("Sub-path within settings, e.g. [\"theme\", \"color\"]");

// ───── Node ───────────────────────────────────────────────────────────────

const node = {
  paramSchema: s.number().describe("Node-ID"),

  resolve: async (id: number, ctx: Ctx) => {
    const app = ctx.app;
    const n = await cms(app).node(id);
    if (!n.exists()) throw new NotFoundError(`Node ${id} not found`);
    if ((await n.access()) < 1) throw new AccessError();
    return n;
  },

  get: {
    description: "Read node as JSON",
    ...nodeRead,
    execute: ({ node }: { node: Node }) => fns.nodeToJson(node),
  },

  delete: {
    description: "Delete node (may go to trash)",
    ...nodeWrite,
    execute: ({ node }: { node: Node }) => fns.nodeRemove(node),
  },

  restore: {
    description: "Restore node from trash to original location",
    ...nodeWrite,
    execute: ({ node }: { node: Node }) => fns.nodeRestore(node),
  },

  sitemap: {
    get: {
      description: "Read page tree from this node (id and title only)",
      ...nodeRead,
      execute: async ({ node }: { node: Node }) => (await fns.treeToJson({
        node,
        self: true,
        type: "p",
        entry: async (n) => ({
          id: Number(n.id),
          title: String(await n.showTitle()).trim() || "-",
        }),
      }))[0],
    },
  },

  tree: {
    get: {
      description: "Read page tree from this node",
      ...nodeRead,
      query: s.object({
        filter: s.optional(s.string()).describe("Type filter, e.g. \"p\" for pages, \"*\" for all"),
        level: s.optional(s.number()).describe("Max depth (0 = unlimited)"),
      }),
      execute: ({ node, filter, level }: any) =>
        fns.tree(node.id, { filter: filter ?? "*", level: level ?? 0 }),
    },
  },

  html: {
    get: {
      description: "Render node as HTML",
      ...nodeRead,
      input: s.object({ vars: s.optional(s.record()) }),
      execute: async ({ node, vars }: any) => String(await node.html(vars)),
    },
    post: {
      description: "Render node as HTML (vars as JSON body)",
      ...nodeRead,
      input: s.object({ vars: s.optional(s.any()) }),
      execute: async ({ node, vars }: any) => String(await node.html(vars)),
    },
    part: {
      ":part": {
        paramSchema: s.string(),
        get: {
          description: "Render a specific HTML part of the node",
          ...nodeRead,
          input: s.object({ vars: s.optional(s.record()) }),
          execute: async ({ node, part, vars }: any) =>
            String(await node.htmlPart(part, vars) || ""),
        },
        post: {
          description: "Render a specific HTML part of the node (vars as JSON body)",
          ...nodeRead,
          input: s.object({ vars: s.optional(s.any()) }),
          execute: async ({ node, part, vars }: any) =>
            String(await node.htmlPart(part, vars) || ""),
        },
      },
    },
  },

  name: {
    put: {
      description: "Set the internal name of the node",
      ...nodeWrite,
      input: s.object({ value: s.string() }),
      execute: async ({ node, value }: any) => {
        await node.set("name", value);
        return { ok: true };
      },
    },
  },

  title: {
    put: {
      description: "Set node title (language-specific)",
      ...nodeWrite,
      input: s.object({ value: s.string(), lang: s.optional(s.string()).describe("Language code, e.g. \"de\". Default: current language.") }),
      output: s.object({ changed: s.boolean() }),
      execute: async ({ node, value, lang }: any, ctx: Ctx) => {
        const changed = await node.title(lang ?? ctx.lang, value);
        return { changed: !!changed };
      },
    },
  },

  text: {
    ":name": {
      paramSchema: s.string().describe("Text field name"),
      put: {
        description: "Set a text field (html) of the node (language-specific)",
        ...nodeWrite,
        input: s.object({ value: s.string(), lang: s.optional(s.string()).describe("Language code, e.g. \"de\". Default: current language.") }),
        output: s.object({ changed: s.boolean() }),
        execute: async ({ node, name, value, lang }: any, ctx: Ctx) => {
          const changed = await node.text(name, lang ?? ctx.lang, value);
          return { changed: !!changed };
        },
      },
    },
  },

  visible: {
    put: {
      description: "Set node visibility flag",
      ...nodeWrite,
      input: s.object({ value: s.boolean() }),
      execute: async ({ node, value }: any) => {
        await node.set("visible", value ? 1 : 0);
        return { ok: true };
      },
    },
  },

  searchable: {
    put: {
      description: "Set node searchability flag",
      ...nodeWrite,
      input: s.object({ value: s.boolean() }),
      execute: async ({ node, value }: any) => {
        await node.set("searchable", value ? 1 : 0);
        return { ok: true };
      },
    },
  },

  module: {
    put: {
      description: "Set the module of the node",
      ...nodeWrite,
      input: s.object({
        module: s.string().describe("Module name, e.g. \"cms.default\""),
        recursive: s.boolean().default(false).describe("If true, apply to all sub-pages too"),
      }),
      execute: async ({ node, module, recursive }: any, ctx: Ctx) => {
        await requireModuleAdmin(module, ctx);
        if (!recursive) {
          await node.set("module", module);
          return { ok: true };
        }
        let done = 0, has = 0;
        const bough = await node.bough({ type: "p" });
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
      description: "Set node online-start time (ISO string or Unix timestamp)",
      ...nodeWrite,
      input: s.object({ value: s.optional(s.string()).describe("ISO string (\"2024-01-01T00:00:00\") or Unix timestamp. Omit to remove limit.") }),
      execute: async ({ node, value }: any) => {
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
      description: "Set node online-end time (ISO string or Unix timestamp)",
      ...nodeWrite,
      input: s.object({ value: s.optional(s.string()).describe("ISO string (\"2024-12-31T23:59:59\") or Unix timestamp. Omit to remove limit.") }),
      execute: async ({ node, value }: any) => {
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
      ...nodeWrite,
      input: s.object({ title: s.string() }),
      execute: async ({ node, title }: any, ctx: Ctx) => {
        const id = await node.createChild();
        if (!id) throw new Error("createChild failed");
        const child = await node.cms.node(id);
        await child.title(ctx.lang, title);
        await child.changeUser(ctx.user!, 3);
        return fns.nodeToJson(child);
      },
    },
  },

  copy: {
    post: {
      description: "Copy node",
      ...nodeWrite,
      input: s.object({ deep: s.boolean().default(false).describe("If true, sub-pages are copied too") }),
      output: s.object({ id: s.string() }),
      execute: async ({ node, deep }: any, ctx: Ctx) => {
        const copied = await node.copy(deep, async (cp: any) => {
          if ((await cp.access()) < 1) return false;
        });
        if (!copied) throw new AccessError();
        await copied.changeUser(ctx.user, 3);
        const titleStr = String(await copied.showTitle()).trim();
        await copied.title(ctx.lang, titleStr ? titleStr + " (copy)" : "");
        return { id: String(copied.id) };
      },
    },
  },

  "insert-before": {
    put: {
      description: "Move a node into this node",
      ...nodeWrite,
      input: s.object({
        id: s.string().describe("ID of the node to move"),
        before: s.optional(s.string()).describe("Insert before this node-ID. Omit to append."),
      }),
      execute: async ({ node, id, before }: any) => {
        const child = await node.cms.node(id);
        if ((await child.access()) < 2) throw new AccessError();
        if (await node.in(child)) throw new ConflictError("would create a loop");
        await node.insertBefore(child, before);
        return { ok: true };
      },
    },
  },

  contents: {
    get: {
      description: "Read content blocks of this node (id, module, name, children)",
      ...nodeRead,
      execute: ({ node }: { node: Node }) => fns.treeToJson({
        node,
        type: "c",
        entry: async (n) => ({
          id: Number(n.id),
          module: String(n.vs?.module ?? ""),
          name: n.vs?.name ?? undefined,
          title: String(await n.showTitle()).trim() || undefined,
        }),
      }),
    },

    post: {
      description: "Create a new content block",
      ...nodeWrite,
      input: s.object({ module: s.string().describe("Module name, e.g. \"cms.text\"") }),
      execute: async ({ node, module }: any, ctx: Ctx) => {
        await requireModuleAdmin(module, ctx);
        const cont = await node.createCont({ module });
        if (!cont) throw new Error("createCont failed");
        await cont.changeUser(ctx.user, 3);
        return { id: cont.id, html: String(await cont.html()) };
      },
    },
  },

  access: {
    put: {
      description: "Set public access level of the node",
      ...nodeAdmin,
      input: s.object({ value: s.optional(s.number()).describe("Access level (0 = private, 1 = public). Omit to reset.") }),
      execute: async ({ node, value }: any, ctx: Ctx) => {
        await node.set("access", value == null ? null : Number(value));
        await node.changeUser(ctx.user, 3);
        return { public: !!value };
      },
    },

    users: {
      ":user": {
        paramSchema: s.number(),
        put: {
          description: "Set a user's access level on this node",
          ...nodeAdmin,
          input: s.object({
            access: s.number().describe("Access level (1=read, 2=write, 3=admin, 0=revoke)"),
            recursive: s.boolean().default(false).describe("Apply to all sub-pages too"),
          }),
          execute: async ({ node, user, access, recursive }: any) => {
            await node.changeUser(user, access);
            if (!recursive) return { ok: true };
            let done = 0, has = 0;
            const bough = await node.bough({ type: "p" });
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
          description: "Set a group's access level on this node",
          ...nodeAdmin,
          input: s.object({ access: s.number().describe("Access level (1=read, 2=write, 3=admin, 0=revoke)") }),
          execute: async ({ node, group, access }: any) => {
            await node.changeGroup(group, access);
            return { ok: true };
          },
        },
      },
    },
  },

  files: {
    get: {
      description: "List all files of the node",
      ...nodeRead,
      execute: ({ node }: { node: Node }) => node.files(),
    },

    post: {
      description: "Add a file to the node",
      ...nodeWrite,
      input: s.object({
        file: s.optional(s.string()).describe("Filename to add (from upload or server path)"),
        replace: s.optional(s.string()).describe("Existing filename to replace"),
      }),
      execute: ({ node, file, replace }: any) => fns.nodeFileAdd(node, file, replace),
    },

    put: {
      description: "Manually set file order (array of filenames)",
      ...nodeWrite,
      input: s.object({ sort: s.array(s.string()) }),
      execute: async ({ node, sort }: any) => {
        await node.sortFiles(sort);
        return { ok: true };
      },
    },

    doubles: {
      delete: {
        description: "Delete duplicate files (same MD5)",
        ...nodeWrite,
        execute: async ({ node }: { node: Node }) => {
          const files = await node.files();
          const seen: Record<string, boolean> = {};
          for (const [name, F] of Object.entries(files)) {
            const md5 = F.vs?.md5;
            if (md5 && seen[md5]) await node.deleteFile(name);
            if (md5) seen[md5] = true;
          }
          return { ok: true };
        },
      },
    },

    all: {
      delete: {
        description: "Delete all files of the node",
        ...nodeWrite,
        execute: async ({ node }: { node: Node }) => {
          for (const name of Object.keys(await node.filesAndPlaceholders())) {
            await node.deleteFile(name);
          }
          return { ok: true };
        },
      },
    },

    order: {
      post: {
        description: "Sort files by criterion",
        ...nodeWrite,
        input: s.object({ by: s.string().describe("Sort criterion: \"name\", \"name_reverse\", \"date\", \"sort\"") }),
        execute: async ({ node, by }: any) => {
          await fns.filesSetOrder(node, by);
          return { ok: true };
        },
      },
    },

    ":file": {
      paramSchema: s.string().describe("Filename"),
      delete: {
        description: "Delete a file from the node",
        ...nodeWrite,
        execute: ({ node, file }: any) => node.deleteFile(file),
      },
    },
  },

  urls: {
    ":lang": {
      paramSchema: s.string().describe("Language code, e.g. \"de\""),
      put: {
        description: "Set custom URL for a language",
        ...nodeWrite,
        input: s.object({ url: s.string() }),
        execute: async ({ node, lang, url }: any) => {
          await node.urlSet(lang, { url, custom: 1 });
          return node.urlSeoGen(lang);
        },
      },

      custom: {
        delete: {
          description: "Remove custom URL for a language (restores SEO URL)",
          ...nodeWrite,
          execute: async ({ node, lang }: any) => {
            await node.urlSet(lang, { custom: 0 });
            return node.urlSeoGen(lang);
          },
        },
      },

      target: {
        put: {
          description: "Set URL target for a language",
          ...nodeWrite,
          input: s.object({ value: s.optional(s.string()).describe("Link target, e.g. \"_blank\". Omit to reset.") }),
          execute: async ({ node, lang, value }: any) => {
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
      ...nodeWrite,
      input: s.object({ url: s.string() }),
      execute: async ({ node, url }: any, ctx: Ctx) => {
        if (await fns.requestUsed(url)) throw new Error("URL already in use");
        await ctx.app.db.table("page_redirect").insert({ request: url, redirect: node.id });
        return { ok: true };
      },
    },

    delete: {
      description: "Remove a redirect URL",
      ...nodeWrite,
      input: s.object({ url: s.string() }),
      execute: async ({ node, url }: any, ctx: Ctx) => {
        await ctx.app.db.table("page_redirect").deleteWhere({ request: url, redirect: node.id });
        return { ok: true };
      },
    },
  },

  settings: {
    ":path*": {
      paramSchema: settingsPath,
      get: {
        description: "Read node settings at path",
        ...nodeRead,
        query: s.object({ schema: s.optional(s.boolean()).describe("If true, return the JSON schema instead of the value") }),
        execute: ({ node, path, schema }: any) => schema ? node.settings[$item].sub(path).schema ?? {} : itemReadDeep(node.settings[$item].sub(path)) },
      put: {
        description: "Set node settings at path",
        ...nodeWrite,
        input: s.object({ value: s.any().describe("Value to set (any JSON type)") }),
        execute: async ({ node, path, value }: any) => {
          await node.settings[$item].sub(path).set(value);
          return { ok: true };
        },
      },
      delete: {
        description: "Delete node settings at path",
        ...nodeWrite,
        execute: async ({ node, path }: any) => {
          if (!path?.length) throw new ConflictError("Cannot delete node settings root");
          await node.settings[$item].sub(path).remove();
          return { ok: true };
        },
      },
    },
  },

  api: {
    post: {
      description: "Call module-specific node API",
      ...nodeRead,
      execute: async ({ node }: { node: Node }, ctx: Ctx) => {
        try {
          const api = node.module?.plugin?.cms?.node?.api;
          if (typeof api !== "function") return null;
          const vars = ctx.req.body;
          return await api(node, vars) ?? null;
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
      access: Access.USER,
      query: s.object({
        filter: s.optional(s.string()).describe("Type filter, e.g. \"p\" for pages, \"*\" for all"),
        level: s.optional(s.number()).describe("Max depth (0 = unlimited)"),
      }),
      execute: ({ filter, level }: any) =>
        fns.tree(0, { filter: filter ?? "*", level: level ?? 0 }),
    },
  },

  nodes: {
    get: {
      description: "Search nodes by title",
      access: Access.USER,
      input: s.object({ q: s.string().describe("Search query") }),
      execute: ({ q }: any) => fns.searchNodes(q),
    },
  },

  files: {
    get: {
      description: "Search files",
      access: Access.USER,
      input: s.object({ q: s.string().describe("Search query") }),
      execute: ({ q }: any) => fns.searchFiles(q),
    },
  },

  clipboard: {
    put: {
      description: "Set clipboard node (cut)",
      access: Access.USER,
      input: s.object({ value: s.optional(s.number()).describe("Node-ID to cut. Omit to clear clipboard.") }),
      execute: async ({ value }: any, ctx: Ctx) => {
        if (value) {
          const P = await cms(ctx.app).node(value);
          if ((await P.access()) < 2) throw new AccessError();
        }
        await ctx.settings.cms.clipboard(Number(value ?? 0));
        return { ok: true };
      },
    },
  },

  "request-used": {
    get: {
      description: "Check if a URL is already used as a redirect",
      access: Access.USER,
      input: s.object({ url: s.string() }),
      execute: ({ url }: any) => fns.requestUsed(url).then((used) => ({ used })),
    },
  },

  "node-id-from-txt-id": {
    get: {
      description: "Get node ID from a text ID (title or text field)",
      access: Access.USER,
      input: s.object({ id: s.number() }),
      execute: async ({ id }: any, ctx: Ctx) => {
        const db = ctx.app.db;
        const pid = await db.one`SELECT page_id FROM page_text WHERE text_id = ${id}`;
        if (pid) return { id: pid };
        const pid2 = await db.one`SELECT id FROM page WHERE title_id = ${id}`;
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
        access: Access.USER,
        input: s.object({ value: s.string(), lang: s.optional(s.string()).describe("Language code, e.g. \"de\". Default: current language") }),
        execute: async ({ id, value, lang }: any, ctx: Ctx) => {
          const db = ctx.app.db;
          const lang_ = lang ?? ctx.lang;
          const row = await db.row`SELECT name, page_id FROM page_text WHERE text_id = ${id}`;
          if (row) {
            const n = await cms(ctx.app).node(row.page_id);
            if (!n.exists()) throw new NotFoundError();
            if ((await n.access()) < 2) throw new AccessError();
            const changed = await n.text(row.name, lang_, value);
            return { changed: !!changed, kind: "text" };
          }
          const pid = await db.one`SELECT id FROM page WHERE title_id = ${id}`;
          if (pid) {
            const n = await cms(ctx.app).node(Number(pid));
            if (!n.exists()) throw new NotFoundError();
            if ((await n.access()) < 2) throw new AccessError();
            const changed = await n.title(lang_, value);
            return { changed: !!changed, kind: "title" };
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
