/**
 * CMS server interface classes
 * Port of cms/qg.serverInterface.php + cms/lib/serverInterface_Page.class.php + serverInterface_Cms.class.php
 */

// deno-lint-ignore-file no-explicit-any

import { serverInterface } from "../core/lib/serverInterface.ts";
import { cmsGetTree } from "./apt-exports.ts";

// ─── serverInterface_page ──────────────────────────────────────────────────

serverInterface.page = {
  $node: null,

  async onBefore(_fn: string, pid: any): Promise<boolean> {
    if (!pid) return false;
    this.$node = await this.ctx.app.cms.node(pid);
    this.Answer = this.ctx.state.Answer;
    this.apt = this.ctx.app.apt.cms;
    const access = await this.$node.access();
    if (access < 1) {
      this.Answer["cmsWarning"] = await this.ctx.app
        .t`Ihnen fehlen die nötigen Berechtigungen den Inhalt zu sehen.`;
      return false;
    }
    if (!(await this.$node.is())) {
      this.Answer["cmsWarning"] = await this.ctx.app
        .t`Die Seite existiert nicht.`;
      return false;
    }
    return true;
  },

  async get(_: any, vars: any = {}): Promise<any> {
    return { html: await this.$node.html(vars) };
  },

  async getWithHead(_: any, vars: any = {}): Promise<any> {
    const html = await this.$node.html(vars);
    this.Answer["head"] = this.ctx.html.getHeader();
    return { html };
  },

  getPart(_: any, part: string, vars: any = {}): Promise<any> {
    return this.$node.getPart(part, vars);
  },

  async reload(pid: any, vars: any = {}): Promise<void> {
    const id = parseInt(String(pid));
    const str = await this.$node.html(vars);
    this.Answer["replaceElements"] = this.Answer["replaceElements"] ?? {};
    this.Answer["replaceElements"][".-pid" + id] = str;
  },

  async loadPart(
    pid: any,
    parts: string | string[],
    vars: any = {},
  ): Promise<void> {
    const id = parseInt(String(pid));
    const Answer = this.Answer;
    Answer["updateElements"] = Answer["updateElements"] ?? {};
    for (const part of Array.isArray(parts) ? parts : [parts]) {
      Answer["updateElements"][`.-pid${id} [data-part="${part}"]`] = await this
        .$node.htmlPart(part, vars);
    }
  },

  async setVisible(pid: any, v: any): Promise<void> {
    await this.apt.node(pid).visible.put({ value: !!v });
    this.Answer["cmsInfo"] = await this.ctx.app
      .t`"Sichtbar in der Navigation" wurde geändert.`;
  },

  async setSearchable(pid: any, v: any): Promise<void> {
    await this.apt.node(pid).searchable.put({ value: !!v });
    this.Answer["cmsInfo"] = await this.ctx.app
      .t`"Durchsuchbar" wurde geändert.`;
  },

  async setModule(pid: any, v: string, req = 0): Promise<void> {
    const result = await this.apt.node(pid).module.put({
      module: v,
      recursive: !!req,
    });
    const Answer = this.Answer;
    if (req) {
      Answer["cmsInfo"] = await this.ctx.app.t`Bei ${String(result.done)} von ${
        String(result.has)
      } Seiten hatten Sie die Berechtigung das Modul zu ändern`;
    } else {
      Answer["cmsInfo"] = await this.ctx.app.t`Das Layout wurde geändert.`;
    }
  },

  async name(pid: any, value: string): Promise<void> {
    await this.apt.node(pid).name.put({ value });
  },

  async text(
    pid: any,
    name: string,
    l: string,
    value?: any,
  ): Promise<number | false> {
    const result = await this.apt.node(pid).text(name).put({ value, lang: l });
    if (result?.changed !== false) {
      this.Answer["cmsInfo"] = await this.ctx.app
        .t`Der Text wurde gespeichert.`;
    }
    return 1;
  },

  async title(pid: any, l: string, value?: any): Promise<number | false> {
    const result = await this.apt.node(pid).title.put({ value, lang: l });
    if (result?.changed !== false) {
      this.Answer["cmsInfo"] = await this.ctx.app
        .t`Der Titel wurde gespeichert.`;
    }
    return 1;
  },

  async onlineStart(pid: any, v: any): Promise<void> {
    await this.apt.node(pid)["online-start"].put({ value: v });
    await this.reload(pid);
    this.Answer["cmsInfo"] = await this.ctx.app.t`Terminierung geändert`;
  },

  async onlineEnd(pid: any, v: any): Promise<void> {
    await this.apt.node(pid)["online-end"].put({ value: v });
    await this.reload(pid);
    this.Answer["cmsInfo"] = await this.ctx.app
      .t`Die Terminierung wurde geändert.`;
  },

  async createChild(pid: any, title: string): Promise<any> {
    if (!title) return false;
    const result = await this.apt.node(pid).children.post({ title });
    this.Answer["cmsInfo"] = await this.ctx.app.t`Die Seite wurde erstellt.`;
    return result;
  },

  async copy(pid: any, deep = false): Promise<string | void> {
    const result = await this.apt.node(pid).copy.post({ deep });
    this.Answer["cmsInfo"] = await this.ctx.app.t`Die Seite wurde kopiert.`;
    return result.id;
  },

  async setPublic(pid: any, v: any): Promise<boolean | void> {
    const result = await this.apt.node(pid).access.put({ value: parseInt(v) });
    this.Answer["cmsInfo"] = await this.ctx.app
      .t`Die Berechtigungen wurden geändert.`;
    return result.public;
  },

  async changeUser(
    pid: any,
    usr_id: any,
    access: number,
    req = false,
  ): Promise<boolean | void> {
    const result = await this.apt.node(pid).access.users(usr_id).put({
      access,
      recursive: req,
    });
    const Answer = this.Answer;
    if (req) {
      Answer["cmsInfo"] = await this.ctx.app.t`Bei ${String(result.done)} von ${
        String(result.has)
      } Seiten hatten Sie die Berechtigung das Zugriffsrecht zu ändern`;
      return;
    }
    Answer["cmsInfo"] = await this.ctx.app
      .t`Die Benutzer-Berechtigungen wurden geändert.`;
    return true;
  },

  async changeGroup(
    pid: any,
    grp_id: any,
    access: number,
  ): Promise<boolean | void> {
    await this.apt.node(pid).access.groups(grp_id).put({ access });
    this.Answer["cmsInfo"] = await this.ctx.app
      .t`Die Gruppen-Berechtigungen wurden geändert.`;
    return true;
  },

  async remove(pid: any): Promise<any> {
    const isContent = this.$node.vs?.["type"] === "c";
    const ret = await this.apt.node(pid).delete();
    this.Answer["cmsInfo"] = await this.ctx.app.t`${
      isContent ? "Der Inhalt" : "Die Seite"
    } wurde gelöscht.`;
    return ret;
  },

  async insertBefore(_pid: any, page: any, before?: any): Promise<void> {
    const Page = await this.ctx.app.cms.node(page);
    const Answer = this.Answer;
    if ((await Page.access()) < 2) {
      Answer["cmsWarning"] = await this.ctx.app
        .t`Sie besitzen auf der Zielseite nicht die benötigten Berechtigungen!`;
      return;
    }
    if (await this.$node.in(Page)) {
      Answer["cmsError"] = await this.ctx.app
        .t`Die gewünschte Basis befindet sich innerhalb dieser Seite, dies würde eine Endlosschleife produzieren!`;
      return;
    }
    const done = await this.$node.insertBefore(Page, before);
    if (done) {
      Answer["cmsInfo"] = await this.ctx.app.t`Der Inhalt wurde verschoben.`;
    }
  },

  async addContent(pid: any, mod: string): Promise<any> {
    const result = await this.apt.node(pid).contents.post({ module: mod });
    this.Answer = {
      cmsInfo: await this.ctx.app.t`Der neue Inhalt wurde erstellt.`,
      head: this.ctx.html.getHeader(),
    };
    return result;
  },

  async setDefault(pid: any, v: any, reload = true): Promise<void> {
    await this.apt.node(pid).defaults.put({ value: v });
    if (this.$node.vs?.["type"] === "c" && reload) {
      await this.reload(pid);
    } else {
      this.Answer["cmsInfo"] = await this.ctx.app
        .t`Die Einstellung wurde geändert.`;
    }
  },

  setUser(_pid: any, _v: any): Promise<number> {
    throw new Error("Method verworfen.");
  },

  async FileDelete(pid: any, name: string): Promise<any> {
    const done = await this.apt.node(pid).files(name).delete();
    this.Answer["cmsInfo"] = await this.ctx.app.t`Die Datei wurde gelöscht.`;
    await this.reload(pid);
    return done;
  },

  async FilesSort(pid: any, sort: any): Promise<any> {
    await this.apt.node(pid).files.put({ sort });
    this.Answer["cmsInfo"] = await this.ctx.app.t`Die Dateien wurden sortiert.`;
    return await this.reload(pid);
  },

  async FileAdd(pid: any, file?: any, replace?: any): Promise<any> {
    const result = await this.apt.node(pid).files.post({ file, replace });
    this.Answer["cmsInfo"] = await this.ctx.app.t`Die Datei wurde hinzugefügt.`;
    return result;
  },

  async filesSetOrder(pid: any, what: string): Promise<number | false> {
    await this.apt.node(pid).files.order.post({ by: what });
    await this.reload(pid);
    return 1;
  },

  async filesDeleteDouble(pid: any): Promise<number | false> {
    await this.apt.node(pid).files.doubles.delete();
    await this.reload(pid);
    return 1;
  },

  async filesDeleteAll(pid: any): Promise<number | false> {
    await this.apt.node(pid).files.all.delete();
    await this.reload(pid);
    return 1;
  },

  urlCustomSet(pid: any, lang: string, url: string): Promise<any> {
    return this.apt.node(pid).urls(lang).put({ url });
  },

  urlCustomUnset(pid: any, lang: string): Promise<any> {
    return this.apt.node(pid).urls(lang).custom.delete();
  },

  async urlTargetSet(pid: any, lang: string, v: any): Promise<number | false> {
    await this.apt.node(pid).urls(lang).target.put({ value: v });
    return 1;
  },

  async requestAdd(pid: any, v: string): Promise<number | void> {
    const { used } = await this.apt["request-used"].get({ url: v });
    if (used) {
      this.Answer["cmsWarning"] = await this.ctx.app
        .t`Diese URL wird bereits verwendet.`;
      return;
    }
    await this.apt.node(pid).redirects.post({ url: v });
    return 1;
  },

  async requestDel(pid: any, v: string): Promise<number | false> {
    await this.apt.node(pid).redirects.delete({ url: v });
    return 1;
  },

  async settingsGet(
    pid: any,
    subpath?: string,
  ): Promise<{ data: any; schema: any }> {
    return await this.apt.node(pid).settings.get({ path: subpath });
  },

  async settingsSet(pid: any, subpath: string, value: any): Promise<void> {
    await this.apt.node(pid).settings.put({ path: subpath, value });
  },

  api(pid: any, vars: any = {}): Promise<any> {
    return this.apt.node(pid).api.post(vars);
  },
};

// ─── serverInterface_cms ───────────────────────────────────────────────────

serverInterface.cms = {
  onBefore(_fn: string): void {
    this.Answer = this.ctx.state.Answer;
    this.apt = this.ctx.app.apt.cms;
  },

  searchNodesByTitle(search: string): Promise<any[]> {
    return this.apt.nodes.get({ q: search });
  },
  /** @deprecated use searchNodesByTitle() */
  searchPagesByTitle(search: string): Promise<any[]> {
    console.warn(
      "searchPagesByTitle() is deprecated, use searchNodesByTitle()",
    );
    return this.searchNodesByTitle(search);
  },

  searchFile(s: string): Promise<any[]> {
    return this.apt.files.get({ q: s });
  },

  async requestUsed(v: string): Promise<boolean> {
    const { used } = await this.apt["request-used"].get({ url: v });
    return used;
  },

  async setTxt(id: any, v: any, lang?: string): Promise<any> {
    const result = await this.apt.txt(id).put({ value: v, lang });
    if (result?.changed) {
      this.Answer["cmsInfo"] = result.kind === "title"
        ? await this.ctx.app.t`Der Titel wurde gespeichert.`
        : await this.ctx.app.t`Der Text wurde gespeichert.`;
    }
    return 1;
  },

  async pidFromTxtId(id: any): Promise<any> {
    const result = await this.apt["pid-from-txt-id"].get({ id: parseInt(id) });
    return result?.id ?? null;
  },

  toJson(pid: any, _type = "*"): Promise<any> {
    return this.apt.node(pid).get();
  },

  getTree(Start: any, opt: any = {}): Promise<any[]> {
    const params = {
      filter: opt["filter"] ?? "*",
      level: opt["level"] ?? 0,
      in: opt["in"],
    };
    return cmsGetTree(Start, params);
  },

  async clipboardSet(pid: any): Promise<void> {
    await this.apt.clipboard.put({ value: pid ? parseInt(String(pid)) : 0 });
    this.Answer["cmsInfo"] = await this.ctx.app
      .t`Fügen Sie den ausgeschnittenen Inhalt auf einer anderen Seite wieder ein.`;
  },
};
