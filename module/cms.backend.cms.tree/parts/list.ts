import { html, type HtmlString, unixTime, type Ctx } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

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

  const showContents = admin.showContents();
  const treeType = showContents ? "*" : "p";

  const rootId = Number(admin.rootPageNode()) || 1;
  const rootNode = await node.cms.node(rootId);

  const trs: HtmlString[] = [];

  await renderChildren(rootNode, 0);
  return html.join(trs);

  async function loopConts(page: Node): Promise<{ onlineStart: number; onlineEnd: number; access: number }> {
    const data = { onlineStart: 0, onlineEnd: 0, access: 0 };
    for (const cont of await page.conts()) {
      const child = await loopConts(cont);
      data.onlineStart += child.onlineStart;
      data.onlineEnd += child.onlineEnd;
      data.access += child.access;
      if (cont.vs.online_start != null) data.onlineStart++;
      if (cont.vs.online_end != null) data.onlineEnd++;
      if (cont.vs.access != null) data.access++;
    }
    return data;
  }

  async function renderChildren(parent: Node, level: number): Promise<void> {
    const children = await parent.children({ type: treeType });
    for (const [, subPage] of children) {
      const subAccess = await subPage.access();
      const open = openPageNodes.has(String(subPage.id));
      const isCont = subPage.vs.type === "c";
      const contsData = await loopConts(subPage);

      const toggleBtn = (await subPage.children({ type: treeType })).size
        ? html`<button class="u2-unstyle -toggle" data-toggle-node="${node.id}" data-toggle-id="${subPage.id}" data-toggle-value="${open ? 0 : 1}"><u2-ico icon="${open ? "remove" : "add"}">${open ? "−" : "+"}</u2-ico></button>`
        : html`<span class=-toggle></span>`;

      // Title cell
      let titleCell: HtmlString;
      if (subAccess < 1) {
        titleCell = html`<span style="flex:1; color:#bbb">(${await t`no access`})</span>`;
      } else {
        const titleObj = await subPage.title();
        const titleLang = titleObj ? await titleObj.orFallback(ctx.lang) : null;
        const titleText = titleLang ? await titleLang.get() : "";
        const inputStyle = html.raw('style="flex:1; background:transparent; border:none; margin:0 .625rem 0 0; padding:0"');
        const edit = subAccess < 2 ? html.raw("disabled") : html`cmstxt="${titleObj?.id ?? 0}"`;
        titleCell = html`<input value="${titleText}" ${inputStyle} ${edit}>`;
      }

      const linkCell = html`<a style="vertical-align:middle" href="${await subPage.url()}" title=open><u2-ico icon=open_in_new>↗</u2-ico></a>`;

      trs.push(html`
<tr${isCont ? html.raw(' class=-isCont') : ''}>
  <td style="text-align:right; font-weight:bold">
    <a title="${await t`Set as start point`}" href="${"?rp=" + subPage.id}">${subPage.id}</a>
  <td style="padding-left:${level * 15}px">
    <div style="display:flex; align-items:center">
      ${toggleBtn}
      ${titleCell}
      ${linkCell}
    </div>
  <td>${renderOnlineStart(subPage, subAccess)}
  <td>${await renderOnlineEnd(subPage, subAccess, contsData.onlineEnd)}
  <td>${await renderAccess(subPage, subAccess, contsData.access)}
  <td>${renderFlag("visible", subPage, subAccess)}
  <td>${renderFlag("searchable", subPage, subAccess)}
  <td><span>${subPage.vs.module}</span>`);

      if (open) await renderChildren(subPage, level + 1);
    }
  }

  function renderOnlineStart(subPage: Node, access: number): HtmlString | string {
    if (access === 0) return "---";
    const onlineStart = subPage.vs.online_start;
    const ok = !onlineStart || Number(onlineStart) < unixTime();
    const iso = onlineStart ? new Date(Number(onlineStart) * 1000).toISOString() : "";
    const date = iso ? html`<u2-time datetime="${iso}" type=relative>${iso.slice(0, 16).replace("T", " ")}</u2-time>` : "---";
    if (access <= 2) return html`<span style="color:${ok ? "#8a8" : "#a88"}">${date}</span>`;
    return html`<span style="color:${ok ? "green" : "red"}">${date}</span>`;
  }

  async function renderOnlineEnd(subPage: Node, access: number, numNotInherit: number): Promise<HtmlString | string> {
    if (access === 0) return "---";
    const onlineEnd = subPage.vs.online_end;
    const ts = onlineEnd == null ? null : Number(onlineEnd);
    const iso = ts ? new Date(ts * 1000).toISOString() : "";
    const date = onlineEnd == null
      ? await t`inherited`
      : (ts === 0 ? await t`always` : html`<u2-time datetime="${iso}" type=relative>${iso.slice(0, 16).replace("T", " ")}</u2-time>`);

    const badge = notInheritBadge(numNotInherit, access, "&quot;online until&quot;");

    if (access <= 2) return html`<span style="color:#8a8">${date}</span>${badge}`;

    const now = unixTime();
    const endTs = Number(onlineEnd ?? "0");
    const maxSec = 60 * 60 * 24 * 7;
    const diff = Math.min(Math.max(endTs - now, 0), maxSec);
    const r = onlineEnd ? 256 - Math.floor(256 * diff / maxSec) : 0;
    const g = onlineEnd ? Math.floor(256 * diff / maxSec) - 128 : 128;
    return html`<span style="color:rgb(${r},${g},0)">${date}</span>${badge}`;
  }

  async function renderAccess(subPage: Node, access: number, numNotInherit: number): Promise<HtmlString | string> {
    if (access === 0) return "---";
    const v = subPage.vs.access;
    const label = v == null ? await t`inherited` : (v ? await t`yes` : await t`no`);
    const badge = notInheritBadge(numNotInherit, access, "access");
    if (access <= 2) return html`<span style="color:#666">${label}</span>${badge}`;
    const color = v == null ? "#aaa" : (v ? "green" : "red");
    return html`<button class=u2-unstyle data-toggle=access data-pid="${subPage.id}" data-v="${v == null ? "" : v ? 1 : 0}" style="color:${color}">${label}</button>${badge}`;
  }

  /** Checkbox column for a boolean node flag ("visible" / "searchable"). */
  function renderFlag(flag: string, subPage: Node, access: number): HtmlString | string {
    if (access === 0) return "---";
    return html`<input type=checkbox data-toggle=${flag} data-pid="${subPage.id}"${subPage.vs[flag] ? " checked" : ""}${access === 1 ? " disabled" : ""}>`;
  }
}

/** Warning badge counting contents that override an inherited value. */
function notInheritBadge(num: number, access: number, what: string): HtmlString | string {
  if (!num || access <= 2) return "";
  return html` <span title="Contents where ${html.raw(what)} is not inherited!" style="display:inline-block; background:yellow; border-radius:50%; padding:0 .1875rem">${num}</span>`;
}
