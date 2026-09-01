import { hee, html, getCtx, sql, tableRef, scopeCache } from "@qino/qino";

import { Node } from "./Node.ts";
import { cmsCtx } from "./CmsContext.ts";

import type { HtmlString, App, Module, Db, DbFile, DbText } from "@qino/qino";

// Per-app instances; the plugin's init binds, cms()/cms.get() read. Internal — mod.ts does not export it.
export const cmsInstances = new WeakMap<object, CMS>();

/** The app's cms instance. Throws when cms is not loaded. */
export function cms(app: App): CMS {
  const instance = cmsInstances.get(app);
  if (!instance) throw new Error('module "cms" is not loaded');
  return instance;
}

/** Undefined when cms is not loaded — for optional dependencies. */
cms.get = (app: App): CMS | undefined => cmsInstances.get(app);

export class CMS {
  app: App;
  db: Db;

  #nodes = new Map<number, Promise<Node>>();

  constructor(app: App) {
    this.app = app;
    this.db = app.db;
  }

  node(id = 0, vs?: Record<string, string | number>): Promise<Node> {
    id = Number(id);
    const nodes = scopeCache(this.#nodes, "cms.nodes", () => new Map<number, Promise<Node>>());
    let node = nodes.get(id);
    if (!node) {
      node = new Node(this, id, vs).init().catch((e) => {
        if (nodes.get(id) === node) nodes.delete(id);
        throw e;
      });
      nodes.set(id, node);
    }
    return node;
  }

  clearCache(id?: number) {
    id === undefined ? this.#nodes.clear() : this.#nodes.delete(Number(id));
  }

  async nodesByModule(moduleName: string): Promise<Record<string, Node>> {
    const ret: Record<string, Node> = {};
    for (const vs of await this.db.query`SELECT * FROM ${sql.id(tableRef("page"))} WHERE module = ${moduleName}`)
      ret[vs.id] = await this.node(vs.id, vs);
    return ret;
  }

  async nodeByModule(moduleName: string): Promise<Node | undefined> {
    return Object.values(await this.nodesByModule(moduleName))[0];
  }

  /** Global page of a layout module (child of the system page), created if missing */
  async layoutPage(module: string): Promise<Node> {
    const sysPage = await this.node(5);
    const children = await sysPage.children({ module });
    let lPage = children.values().next().value;
    if (!lPage) {
      lPage = await sysPage.createChild({ module, name: module, access: 1 });
      await lPage.title(this.app.languages.def, module);
    }
    return lPage;
  }

  async nodeFromRequest(): Promise<Node> {
    const ctx = getCtx();
    const cmspid = ctx.req.query.cmspid;
    const pid = cmspid ? Number(cmspid) : Number(
      await this.db.one`SELECT page_id FROM ${sql.id(tableRef("page_url"))} WHERE url = ${ctx.req.appPath}`
    ) || 0;
    return this.node(pid);
  }

  getModules(): Record<string, Module> {
    return this.#modules("cms.cont.");
  }

  getLayouts(): Record<string, Module> {
    return this.#modules("cms.layout.");
  }

  /** Linked only — a deactivated module is nothing a page can be built with. */
  #modules(prefix: string): Record<string, Module> {
    const ret: Record<string, Module> = {};
    for (const mod of this.app.modules.linked().sort((a, b) => a.name.localeCompare(b.name)))
      if (mod.name.startsWith(prefix)) ret[mod.name] = mod;
    return ret;
  }

  // deno-lint-ignore no-explicit-any
  async filter(pages: Map<number, Node>, filter: any): Promise<Map<number, Node>> {
    const parts = Array.isArray(filter) ? filter : [filter];
    const tags = parts.filter((part): part is string => typeof part === "string");
    filter = Object.assign({}, ...parts.filter((part) => part && typeof part === "object"));
    filter.type ??= "p";
    const ret = new Map<number, Node>();
    for (const [id, c] of pages) {
      const vs = c.vs;
      if (filter.type && filter.type !== "*" && vs.type !== filter.type) continue;
      if (filter.visible !== undefined && !!vs.visible !== !!filter.visible) continue;
      if (filter.module) {
        const modules = Array.isArray(filter.module) ? filter.module : [filter.module];
        if (!modules.includes(vs.module)) continue;
      }
      if (filter.access !== undefined && (await c.access()) < filter.access) continue;
      if (tags.includes("navi")) {
        const titleObj = await c.title();
        if (!vs.visible || !(await c.isReadable()) || !(await titleObj.string() || c.edit)) continue;
      }
      if (tags.includes("access") && !(await c.access())) continue;
      if (tags.includes("readable") && !(await c.isReadable())) continue;
      ret.set(id, c);
    }
    return ret;
  }

  /** Hidden fields addressing `node`, for a JS-free `<form method=post>`. */
  formFields(node: Node | number): HtmlString {
    return html.raw(
      `<input type=hidden name=qcms-node value=${Number(node)}>` +
      `<input type=hidden name=csrfToken value="${hee(getCtx().csrfToken)}">`,
    );
  }

  async link(node: Node | number): Promise<HtmlString> {
    const page = await this.node(Number(node));
    return html.raw(`<a${attrsHtml(await this.linkAttributes(page))}>${await page.showTitle()}</a>`);
  }

  async linkAttributes(node: Node | number): Promise<Record<string, string>> {
    const ctx = getCtx();
    const page = await this.node(Number(node));
    const href = await page.url();
    const target = (await page.urls()).get(ctx.lang)?.target;
    const mainNode = cmsCtx(ctx).mainNode || await this.nodeFromRequest();
    const access = await page.access();
    const inside = await mainNode.in?.(page);
    const online = await page.isOnline();
    const titleObj = await page.title();
    return {
      href,
      class: `cmsLink${page}${access?"":" noAccess"}${inside?" cmsInside":""}${!online?" cmsOffline":""}`,
      ...(page.edit ? { cmstxt: String(titleObj?.id ?? "") } : {}),
      ...(mainNode === page ? { "aria-current": "page" } : {}),
      ...(target ? { target } : {}),
    };
  }

  // deno-lint-ignore no-explicit-any
  async url(pidOrUrl?: string, ret: Record<string, any> = {}): Promise<string | undefined> {
    if (!pidOrUrl) return;
    pidOrUrl = pidOrUrl.trim();
    ret.target = "_blank";
    if (/^\d+$/.test(pidOrUrl)) {
      const page = await this.node(Number(pidOrUrl));
      if (page.exists()) {
        ret.target = "_self";
        ret.node = page;
        return page.url();
      }
      return;
    }
    if (!pidOrUrl) return;
    if (!/^[a-z][a-z0-9+.-]*:/i.test(pidOrUrl)) return "http://" + pidOrUrl;
    if (!/^(https?|mailto|tel):/i.test(pidOrUrl)) return; // drop javascript:/data: etc.
    return pidOrUrl;
  }

  // deno-lint-ignore no-explicit-any
  async text(pid: Node | number, name: string, options: Record<string, any> = {}): Promise<HtmlString | string> {
    const node = await this.node(Number(pid));
    const textObj = name === "title" ? await node.title() : await node.text(name);
    const tag = options.tag ?? "div";
    options.contenteditable ??= node.edit;
    if (node.edit) options["cmstxt-placeholder"] ||= name;
    if (options.contenteditable || tag === "input" || tag === "textarea") options.cmstxt = textObj.id;
    let text = await textObj.string();
    if (text === "" && options.initial !== undefined) {
      if (typeof options.initial === "object" && !Array.isArray(options.initial)) {
        for (const l of this.app.languages.all) {
          const lt = textObj.lang(l);
          if (await lt.get() === "") await lt.set(options.initial[l] ?? "");
        }
        text = await textObj.string();
      } else {
        text = options.initial;
        await textObj.lang(this.app.languages.def).set(text);
      }
    }

    const shown = name === "title" ? await node.showTitle() : await node.showText(name);
    text = String(shown);

    // if (shown.lang && shown.lang !== getCtx().lang && !("lang" in options)) {
    //     options.lang = shown.lang;
    // }

    if (options.if && !node.edit && !text.replace(/<[^>]*>/g, "").trim()) return "";
    delete options.if;
    delete options.tag;
    delete options.initial;
    if (tag === "textarea") delete options.contenteditable;
    if (tag === "input") { delete options.contenteditable; options.value = text; text = ""; }
    let attrStr = "";
    for (const [n, v] of Object.entries(options)) {
      if (v === false) continue;
      attrStr += v === true ? ` ${n}` : ` ${n}="${hee(v)}"`;
    }
    return html.raw(`<${tag}${attrStr}>${text}</${tag}>`);
  }

  async fileLang(node: Node, name: string, lang?: string): Promise<DbFile | undefined> {
    lang ||= getCtx().lang;
    // creates every language slot — the lookup below returns early and would leave the rest missing
    for (const l of node.cms.app.languages.all) await node.file(name + " " + l);
    const file = await node.file(name + " " + lang);
    if (await file.exists()) return file;
    for (const l of node.cms.app.languages.all) {
      const f = await node.file(name + " " + l);
      if (await f.exists()) return f;
    }
  }

  async parentFile(node: Node, name: string): Promise<DbFile | undefined> {
    let currentNode: Node | undefined = node;
    while (currentNode) {
      const dbFile = await currentNode.hasFile(name);
      if (dbFile) return dbFile;
      currentNode = await currentNode.parent();
    }
  }

  async parentText(node: Node, name: string): Promise<DbText | undefined> {
    let currentNode: Node | undefined = node;
    while (currentNode) {
      const text = (await currentNode.texts()).get(name);
      if (text) return text;
      currentNode = await currentNode.parent();
    }
  }

}

function attrsHtml(attrs: Record<string, string>): string {
  return Object.entries(attrs).map(([name, value]) => ` ${name}="${hee(value)}"`).join("");
}
