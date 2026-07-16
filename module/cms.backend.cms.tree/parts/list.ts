import { hee, html, type HtmlString, unixTime, type Ctx } from "../../core/mod.ts";
import type { Node } from "../../cms/mod.ts";

export async function list(node: Node, { ctx, vars }: { ctx: Ctx; vars?: Record<string, unknown> }): Promise<HtmlString> {
  const t = node.app.t;
  const admin = ctx.settings.cms.admin;

  if (vars?.toggleOpen != null) {
    const p = String(vars.toggleOpen);
    const openStr: string = admin.openPageNodes() ?? "";
    const openSet = new Set(openStr.split(",").filter(Boolean));
    if (vars.value == "1") openSet.add(p);
    else openSet.delete(p);
    admin.openPageNodes([...openSet].join(","));
  }

  if (vars?.showContents != null) admin.showContents(vars.showContents == "1");

  const openStr: string = admin.openPageNodes() ?? "";
  const openPageNodes = new Set(openStr.split(",").filter(Boolean));

  const showContents = !!admin.showContents();
  const treeType = showContents ? "*" : "p";

  const rootId = Number(admin.rootPageNode() ?? "0") || 1;
  const rootNode = await node.cms.node(rootId);

  let out = "";

  await renderChildren(rootNode, 0);
  return html.raw(out);

  async function loopConts(Page: Node): Promise<{ onlineStart: number; onlineEnd: number; access: number }> {
    const data = { onlineStart: 0, onlineEnd: 0, access: 0 };
    for (const C of await Page.conts()) {
      const child = await loopConts(C);
      data.onlineStart += child.onlineStart;
      data.onlineEnd += child.onlineEnd;
      data.access += child.access;
      if (C.vs.online_start != null) data.onlineStart++;
      if (C.vs.online_end != null) data.onlineEnd++;
      if (C.vs.access != null) data.access++;
    }
    return data;
  }

  async function renderChildren(Parent: Node, level: number): Promise<void> {
    const children = await Parent.children({ type: treeType });
    for (const [, SubPage] of children) {
      const subAccess = await SubPage.access();
      const open = openPageNodes.has(String(SubPage.id));
      const isCont = SubPage.vs.type === "c";
      const contsData = await loopConts(SubPage);

      // Toggle button
      const hasChildren = (await SubPage.children({ type: treeType })).size > 0;
      let toggleBtn = '<span class=-toggle></span>';
      if (hasChildren) {
        toggleBtn = `<button class="u2-unstyle -toggle" data-toggle-node="${node.id}" data-toggle-id="${SubPage.id}" data-toggle-value="${open ? 0 : 1}"><u2-ico icon="${open ? "remove" : "add"}">${open ? "−" : "+"}</u2-ico></button>`;
      }

      // Title cell
      let titleCell: string;
      if (subAccess < 1) {
        titleCell = `<span style="flex:1; color:#bbb">(${await t`no access`})</span>`;
      } else {
        const titleObj = await SubPage.title();
        const titleLang = titleObj ? await titleObj.orFallback(ctx.lang) : null;
        const titleText = titleLang ? hee(String(await titleLang.get() ?? "")) : "";
        const titleId = titleObj?.id ?? 0;
        if (subAccess < 2) {
          titleCell = `<input value="${titleText}" style="flex:1; background:transparent; border:none; margin:0 10px 0 0; padding:0" disabled>`;
        } else {
          titleCell = `<input value="${titleText}" style="flex:1; background:transparent; border:none; margin:0 10px 0 0; padding:0" cmstxt="${hee(String(titleId))}">`;
        }
      }

      const pageUrl = await SubPage.url();
      const linkCell = `<a style="vertical-align:middle" href="${hee(pageUrl)}" title="open"><u2-ico icon=open_in_new>↗</u2-ico></a>`;

      // Online start column
      const onlineStartCell = renderOnlineStart(SubPage, subAccess);

      // Online end column
      const onlineEndCell = await renderOnlineEnd(SubPage, subAccess, contsData.onlineEnd);

      // Access column
      const accessCell = await renderAccess(SubPage, subAccess, contsData.access);

      // Visible column
      const visibleCell = renderVisible(SubPage, subAccess);

      // Searchable column
      const searchableCell = renderSearchable(SubPage, subAccess);

      out += `
<tr${isCont ? ' class=-isCont' : ''}>
  <td style="text-align:right; font-weight:bold">
    <a title="${await t`Set as start point`}" href="${hee("?rp=" + SubPage.id)}">${hee(String(SubPage.id))}</a>
  <td style="padding-left:${level * 15}px">
    <div style="display:flex; align-items:center">
      ${toggleBtn}
      ${titleCell}
      ${linkCell}
    </div>
  <td>${onlineStartCell}
  <td>${onlineEndCell}
  <td>${accessCell}
  <td>${visibleCell}
  <td>${searchableCell}
  <td><span>${hee(String(SubPage.vs.module ?? ""))}</span>`;

      if (open) await renderChildren(SubPage, level + 1);
    }
  }

  function renderOnlineStart(SubPage: Node, access: number): string {
    if (access === 0) return "---";
    const onlineStart = SubPage.vs.online_start;
    const ok = !onlineStart || Number(onlineStart) < unixTime();
    const iso = onlineStart ? new Date(Number(onlineStart) * 1000).toISOString() : "";
    const date = iso ? `<u2-time datetime="${iso}" type=relative>${iso.slice(0, 16).replace("T", " ")}</u2-time>` : "---";
    if (access <= 2) return `<span style="color:${ok ? "#8a8" : "#a88"}">${date}</span>`;
    return `<span style="color:${ok ? "green" : "red"}">${date}</span>`;
  }

  async function renderOnlineEnd(SubPage: Node, access: number, numNotInherit: number): Promise<string> {
    if (access === 0) return "---";
    const onlineEnd = SubPage.vs.online_end;
    const ts = onlineEnd == null ? null : Number(onlineEnd);
    const iso = ts ? new Date(ts * 1000).toISOString() : "";
    const date = onlineEnd == null
      ? await t`inherited`
      : (ts === 0 ? await t`always` : `<u2-time datetime="${iso}" type=relative>${iso.slice(0, 16).replace("T", " ")}</u2-time>`);

    let badge = "";
    if (numNotInherit && access > 2) {
      badge = ` <span title="Contents where &quot;online until&quot; is not inherited!" style="display:inline-block; background:yellow; border-radius:50%; padding:0 3px">${numNotInherit}</span>`;
    }

    if (access <= 2) return `<span style="color:#8a8">${date}</span>${badge}`;

    const now = unixTime();
    const endTs = Number(onlineEnd ?? "0");
    const maxSec = 60 * 60 * 24 * 7;
    const diff = Math.min(Math.max(endTs - now, 0), maxSec);
    const r = onlineEnd ? 256 - Math.floor(256 * diff / maxSec) : 0;
    const g = onlineEnd ? Math.floor(256 * diff / maxSec) - 128 : 128;
    return `<span style="color:rgb(${r},${g},0)">${date}</span>${badge}`;
  }

  async function renderAccess(SubPage: Node, access: number, numNotInherit: number): Promise<string> {
    if (access === 0) return "---";
    const v = SubPage.vs.access;
    const label = v == null ? await t`inherited` : (v ? await t`yes` : await t`no`);
    let badge = "";
    if (numNotInherit && access > 2) {
      badge = ` <span title="Contents where access is not inherited!" style="display:inline-block; background:yellow; border-radius:50%; padding:0 3px">${numNotInherit}</span>`;
    }
    if (access <= 2) return `<span style="color:#666">${hee(label)}</span>${badge}`;
    const color = v == null ? "#aaa" : (v ? "green" : "red");
    return `<button class=u2-unstyle data-toggle=access data-pid="${SubPage.id}" data-v="${v == null ? "" : v ? 1 : 0}" style="color:${color}">${hee(label)}</button>${badge}`;
  }

  function renderVisible(SubPage: Node, access: number): string {
    if (access === 0) return "---";
    return checkbox("visible", SubPage, !!SubPage.vs.visible, access === 1);
  }

  function renderSearchable(SubPage: Node, access: number): string {
    if (access === 0) return "---";
    return checkbox("searchable", SubPage, !!SubPage.vs.searchable, access === 1);
  }

  function checkbox(toggle: string, SubPage: Node, checked: boolean, readonly: boolean): string {
    return `<input type=checkbox data-toggle=${toggle} data-pid="${SubPage.id}"${checked ? " checked" : ""}${readonly ? " disabled" : ""}>`;
  }
}
