// deno-lint-ignore-file no-explicit-any
/**
 * cms/apt.ts — apt Action-Tree für das cms-Modul.
 * Vollständige Portierung aller Routen aus apt-exports.ts.
 */

import { s } from "../core/lib/schema.ts";
import { AccessError, ConflictError, NotFoundError } from "../core/lib/apt.ts";
import { getCtx } from "../core/lib/context.ts";
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
  paramSchema: s.number(),

  resolve: async (id: number) => {
    const app = getCtx().app;
    const n = await app.cms.node(id);
    if (!n.is()) throw new NotFoundError(`Node ${id} not found`);
    if ((await n.access()) < 1) throw new AccessError();
    return n;
  },

  get: {
    description: "Node als JSON lesen.",
    execute: ({ node }: any) => nodeToJson(node.id),
  },

  delete: {
    description: "Node löschen (landet ggf. im Papierkorb).",
    execute: async ({ node }: any) => {
      if ((await node.access()) < 2) throw new AccessError();
      return nodeRemove(node);
    },
  },

  sitemap: {
    get: {
      description: "Seitenbaum ab diesem Node lesen (nur id und Titel).",
      execute: ({ node }: any) => slimTree(node),
    },
  },

  tree: {
    get: {
      description: "Seitenbaum ab diesem Node lesen.",
      input: s.object({
        filter: s.optional(s.string()),
        level: s.optional(s.number()),
      }),
      execute: ({ node, filter, level }: any) =>
        cmsGetTree(node.id, { filter: filter ?? "*", level: level ?? 0 }),
    },
  },

  html: {
    get: {
      description: "Node als HTML rendern.",
      input: s.object({ vars: s.optional(s.record()) }),
      execute: ({ node, vars }: any) => node.html(vars ?? {}),
    },
    post: {
      description: "Node als HTML rendern (mit vars als JSON-Body).",
      input: s.object({ vars: s.optional(s.any()) }),
      execute: ({ node, vars }: any) => node.html(vars ?? {}),
    },
    part: {
      ":part": {
        paramSchema: s.string(),
        get: {
          description: "Einen HTML-Part des Nodes rendern.",
          input: s.object({ vars: s.optional(s.record()) }),
          execute: ({ node, part, vars }: any) =>
            node.htmlPart(part, vars ?? {}),
        },
      },
    },
  },

  name: {
    put: {
      description: "Internen Namen der Seite setzen.",
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
      description: "Titel der Seite setzen (sprachspezifisch).",
      input: s.object({ value: s.string(), lang: s.optional(s.string()) }),
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
      paramSchema: s.string(),
      put: {
        description: "Textfeld einer Seite setzen (sprachspezifisch).",
        input: s.object({ value: s.string(), lang: s.optional(s.string()) }),
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
      description: "Sichtbarkeit in der Navigation setzen.",
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
      description: "Durchsuchbarkeit der Seite setzen.",
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
      description: "Layout-Modul der Seite setzen.",
      input: s.object({
        module: s.string(),
        recursive: s.boolean().default(false),
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
      description: "Online-Start-Zeitpunkt setzen (ISO-String oder Unix-Timestamp).",
      input: s.object({ value: s.optional(s.string()) }),
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
      description: "Online-End-Zeitpunkt setzen (ISO-String oder Unix-Timestamp).",
      input: s.object({ value: s.optional(s.string()) }),
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
      description: "Neue Unterseite erstellen.",
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
      description: "Seite/Inhalt kopieren. Mit deep=true werden Unterseiten mitkopiert.",
      input: s.object({ deep: s.boolean().default(false) }),
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

  position: {
    put: {
      description: "Seite oder Inhalt verschieben (vor eine andere Node einordnen).",
      input: s.object({ target: s.string(), before: s.optional(s.string()) }),
      execute: async ({ node, target, before }: any) => {
        if ((await node.access()) < 2) throw new AccessError();
        const Target = await (getCtx().app as any).cms.node(target);
        if ((await Target.access()) < 2) {
          throw new AccessError("no access on target");
        }
        if (await node.in(Target)) {
          throw new ConflictError("would create a loop");
        }
        await node.insertBefore(Target, before);
        return { ok: true };
      },
    },
  },

  contents: {
    get: {
      description: "Content-Bloecke dieser Seite lesen (id, module, name, children).",
      execute: ({ node }: any) => contentBlocks(node),
    },

    post: {
      description: "Neuen Content-Block erstellen.",
      input: s.object({ module: s.string() }),
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
      description: "Default-Einstellungen der Seite setzen.",
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
      description: "Öffentlichen Zugriff der Seite setzen.",
      input: s.object({ value: s.optional(s.number()) }),
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
          description: "Zugriffslevel eines Users auf dieser Seite setzen.",
          input: s.object({
            access: s.number(),
            recursive: s.boolean().default(false),
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
          description: "Zugriffslevel einer Gruppe auf dieser Seite setzen.",
          input: s.object({ access: s.number() }),
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
      description: "Alle Dateien der Seite auflisten.",
      execute: ({ node }: any) => node.files().then((f: any) => f ?? {}),
    },

    post: {
      description: "Datei zur Seite hinzufügen.",
      input: s.object({
        file: s.optional(s.string()),
        replace: s.optional(s.string()),
      }),
      execute: async ({ node, file, replace }: any) => {
        if ((await node.access()) < 2) throw new AccessError();
        return nodeFileAdd(node, file, replace);
      },
    },

    put: {
      description: "Datei-Reihenfolge manuell setzen (Array von Dateinamen).",
      input: s.object({ sort: s.array(s.string()) }),
      execute: async ({ node, sort }: any) => {
        if ((await node.access()) < 2) throw new AccessError();
        await node.sortFiles(sort);
        return { ok: true };
      },
    },

    doubles: {
      delete: {
        description: "Doppelte Dateien (gleicher MD5) löschen.",
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
        description: "Alle Dateien der Seite löschen.",
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
        description: "Dateien nach Kriterium sortieren (name, name_reverse, date, sort).",
        input: s.object({ by: s.string() }),
        execute: async ({ node, by }: any) => {
          if ((await node.access()) < 2) throw new AccessError();
          await filesSetOrder(node, by);
          return { ok: true };
        },
      },
    },

    ":file": {
      paramSchema: s.string(),
      delete: {
        description: "Eine Datei von der Seite löschen.",
        execute: async ({ node, file }: any) => {
          if ((await node.access()) < 2) throw new AccessError();
          return node.deleteFile(file);
        },
      },
    },
  },

  urls: {
    ":lang": {
      paramSchema: s.string(),
      put: {
        description: "Custom-URL für eine Sprache setzen.",
        input: s.object({ url: s.string() }),
        execute: async ({ node, lang, url }: any) => {
          if ((await node.access()) < 2) throw new AccessError();
          await node.urlSet(lang, { url, custom: 1 });
          return node.urlSeoGen(lang);
        },
      },

      custom: {
        delete: {
          description: "Custom-URL für eine Sprache entfernen (SEO-URL wird wiederhergestellt).",
          execute: async ({ node, lang }: any) => {
            if ((await node.access()) < 2) throw new AccessError();
            await node.urlSet(lang, { custom: 0 });
            return node.urlSeoGen(lang);
          },
        },
      },

      target: {
        put: {
          description: "URL-Target (_blank etc.) für eine Sprache setzen.",
          input: s.object({ value: s.optional(s.string()) }),
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
      description: "Redirect-URL hinzufügen.",
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
      description: "Redirect-URL entfernen.",
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
      description: "Page-Settings lesen. Optional: path=['foo','bar'] für Unterpfad.",
      input: s.object({ path: s.optional(s.array(s.string())) }),
      execute: async ({ node, path }: any) => {
        const item = node.settings[$item].sub(path ?? []);
        return readSettings(item);
      },
    },
    put: {
      description: "Page-Settings setzen.",
      input: s.object({ path: s.optional(s.array(s.string())), value: s.any() }),
      execute: async ({ node, path, value }: any) => {
        if ((await node.access()) < 2) throw new AccessError();
        node.settings[$item].sub(path ?? []).set(value);
        return { ok: true };
      },
    },
    delete: {
      description: "Page-Settings löschen.",
      input: s.object({ path: s.array(s.string()) }),
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
      description: "Schema der Page-Settings lesen. Optional: path=['foo','bar'] für Unterpfad.",
      input: s.object({ path: s.optional(s.array(s.string())) }),
      execute: ({ node, path }: any) => {
        return node.settings[$item].sub(path ?? []).schema ?? {};
      },
    },
  },

  api: {
    post: {
      description: "Modul-spezifische Page-API aufrufen.",
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
      description: "Kompletten Seitenbaum lesen.",
      input: s.object({
        filter: s.optional(s.string()),
        level: s.optional(s.number()),
      }),
      execute: ({ filter, level }: any) =>
        cmsGetTree(0, { filter: filter ?? "*", level: level ?? 0 }),
    },
  },

  nodes: {
    get: {
      description: "Nodes nach Titel suchen.",
      input: s.object({ q: s.string() }),
      execute: ({ q }: any) => cmsSearchNodes(q),
    },
  },

  files: {
    get: {
      description: "Dateien suchen.",
      input: s.object({ q: s.string() }),
      execute: ({ q }: any) => cmsSearchFiles(q),
    },
  },

  clipboard: {
    put: {
      description: "Clipboard-Seite setzen (ausschneiden).",
      input: s.object({ value: s.optional(s.number()) }),
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
      description: "Prüfen ob eine URL bereits als Redirect verwendet wird.",
      input: s.object({ url: s.string() }),
      execute: ({ url }: any) => cmsRequestUsed(url).then((used) => ({ used })),
    },
  },

  "pid-from-txt-id": {
    get: {
      description: "Page-ID zu einer Text-ID ermitteln (Titel oder Textfeld).",
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
      paramSchema: s.number(),
      put: {
        description: "Text oder Titel per Text-ID setzen (Inline-Editor).",
        input: s.object({ value: s.string(), lang: s.optional(s.string()) }),
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
