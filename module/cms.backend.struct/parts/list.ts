// Port of cms.backend.struct/parts/list.php
// deno-lint-ignore-file no-explicit-any

import { hee } from "../../core/lib/util.ts"
import { getCtx } from "../../core/lib/RequestContext.ts";
import type { Node } from "../../cms/lib/Node.ts";
import type { RequestContext } from "../../core/lib/RequestContext.ts";

export async function list(node: Node, { ctx, vars }: { ctx?: RequestContext; vars?: Record<string, unknown> }): Promise<string> {
  ctx ??= getCtx();

  if (vars?.toggleOpen != null) {
    const p = String(vars.toggleOpen);
    const openStr: string = ctx.settings.cms.admin.openPageNodes() ?? "";
    const openSet = new Set(openStr.split(",").filter(Boolean));
    if (vars.value == "1") openSet.add(p);
    else openSet.delete(p);
    ctx.settings.cms.admin.openPageNodes([...openSet].join(","));
  }

  const openStr: string = ctx.settings.cms.admin.openPageNodes() ?? "";
  const openPageNodes = new Set(openStr.split(",").filter(Boolean));

  const rootId = Number(ctx.settings.cms.admin.rootPageNode() ?? "0") || 1;
  const rootNode = await node.cms.node(rootId);

  const sysURL = ctx.sysURL as string;
  let html = "";

  await renderChildren(rootNode, 0);
  return html;

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
    const children = await Parent.children({ type: "*" });
    for (const [, SubPage] of children) {
      const subAccess = await SubPage.access();
      const open = openPageNodes.has(String(SubPage.id));
      const isCont = SubPage.vs.type === "c";
      const contsData = await loopConts(SubPage);

      // Toggle button
      const hasChildren = (await SubPage.children({ type: "*" })).size > 0;
      let toggleBtn = '<span class=-toggle></span>';
      if (hasChildren) {
        const cls = open ? "-minus" : "-plus";
        toggleBtn = `<a class="-toggle ${hee(cls)}" data-toggle-node="${node.id}" data-toggle-id="${SubPage.id}" data-toggle-value="${open ? 0 : 1}"></a>`;
      }

      // Title cell
      let titleCell: string;
      if (subAccess < 1) {
        titleCell = '<span style="flex:1; color:#bbb">(kein Zugriff)</span>';
      } else {
        const titleObj = await SubPage.title();
        const titleLang = titleObj ? await titleObj.orFallback("de") : null;
        const titleText = titleLang ? hee(String(await titleLang.get() ?? "")) : "";
        const titleId = titleObj?.id ?? 0;
        if (subAccess < 2) {
          titleCell = `<input value="${titleText}" style="flex:1; background:transparent; border:none; margin:0 10px 0 0; padding:0" disabled>`;
        } else {
          titleCell = `<input value="${titleText}" style="flex:1; background:transparent; border:none; margin:0 10px 0 0; padding:0" cmstxt="${hee(String(titleId))}">`;
        }
      }

      const pageUrl = await SubPage.url();
      const linkCell = `<a style="vertical-align:middle" href="${hee(pageUrl)}" title="open"><img alt="open" src="${hee(sysURL)}cms.frontend.1/pub/img/open-link.svg" style="display:block; width:18px; height:18px"></a>`;

      // Online start column
      const onlineStartCell = renderOnlineStart(SubPage, subAccess);

      // Online end column
      const onlineEndCell = renderOnlineEnd(SubPage, subAccess, contsData.onlineEnd);

      // Access column
      const accessCell = renderAccess(SubPage, subAccess, contsData.access);

      // Visible column
      const visibleCell = renderVisible(SubPage, subAccess);

      // Searchable column
      const searchableCell = renderSearchable(SubPage, subAccess);

      html += `
<tr${isCont ? ' class=-isCont' : ''}>
  <td style="text-align:right; font-weight:bold">
    <a title="als Startpunkt setzen" href="${hee("?rp=" + SubPage.id)}">${hee(String(SubPage.id))}</a>
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
    const ok = !onlineStart || Number(onlineStart) < Math.floor(Date.now() / 1000);
    const iso = onlineStart ? new Date(Number(onlineStart) * 1000).toISOString() : "";
    const date = iso ? `<u2-time datetime="${iso}" type=relative>${iso.slice(0, 16).replace("T", " ")}</u2-time>` : "---";
    if (access <= 2) return `<span style="color:${ok ? "#8a8" : "#a88"}">${date}</span>`;
    return `<span style="color:${ok ? "green" : "red"}">${date}</span>`;
  }

  function renderOnlineEnd(SubPage: Node, access: number, numNotInherit: number): string {
    if (access === 0) return "---";
    const onlineEnd = SubPage.vs.online_end;
    const ts = onlineEnd == null ? null : Number(onlineEnd);
    const iso = ts ? new Date(ts * 1000).toISOString() : "";
    const date = onlineEnd == null
      ? "vererbt"
      : (ts === 0 ? "immer" : `<u2-time datetime="${iso}" type=relative>${iso.slice(0, 16).replace("T", " ")}</u2-time>`);

    let badge = "";
    if (numNotInherit && access > 2) {
      badge = ` <span title="Inhalte bei denen &quot;Online bis&quot; nicht vererbt wird!" style="display:inline-block; background:yellow; border-radius:50%; padding:0 3px">${numNotInherit}</span>`;
    }

    if (access <= 2) return `<span style="color:#8a8">${date}</span>${badge}`;

    const now = Math.floor(Date.now() / 1000);
    const endTs = Number(onlineEnd ?? "0");
    const maxSec = 60 * 60 * 24 * 7;
    const diff = Math.min(Math.max(endTs - now, 0), maxSec);
    const r = onlineEnd ? 256 - Math.floor(256 * diff / maxSec) : 0;
    const g = onlineEnd ? Math.floor(256 * diff / maxSec) - 128 : 128;
    return `<span style="color:rgb(${r},${g},0)">${date}</span>${badge}`;
  }

  function renderAccess(SubPage: Node, access: number, numNotInherit: number): string {
    if (access === 0) return "---";
    const v = SubPage.vs.access;
    const label = v == null ? "vererbt" : (v ? "ja" : "nein");
    let badge = "";
    if (numNotInherit && access > 2) {
      badge = ` <span title="Inhalte bei denen der Zugriff nicht vererbt wird!" style="display:inline-block; background:yellow; border-radius:50%; padding:0 3px">${numNotInherit}</span>`;
    }
    if (access <= 2) return `<span style="color:#666">${hee(label)}</span>${badge}`;
    const color = v == null ? "#aaa" : (v ? "green" : "red");
    return `<a onclick="return toggleAccess(this, ${SubPage.id})" style="color:${color}" href="">${hee(label)}</a>${badge}`;
  }

  function renderVisible(SubPage: Node, access: number): string {
    if (access === 0) return "---";
    const v = SubPage.vs.visible;
    const label = v ? "ja" : "nein";
    if (access === 1) return `<span style="color:#666">${hee(label)}</span>`;
    return `<a onclick="return toggleVisible(this, ${SubPage.id})" style="color:${v ? "green" : "red"}" href="">${hee(label)}</a>`;
  }

  function renderSearchable(SubPage: Node, access: number): string {
    if (access === 0) return "---";
    const v = SubPage.vs.searchable;
    const label = v ? "ja" : "nein";
    if (access === 1) return `<span style="color:#666">${hee(label)}</span>`;
    return `<a onclick="return toggleSearchable(this, ${SubPage.id})" style="color:${v ? "green" : "red"}" href="">${hee(label)}</a>`;
  }
}
