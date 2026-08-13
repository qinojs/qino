import { html } from "@qino/qino";
import { postedVars } from "@qino/qino/cms";

import type { Ctx, HtmlString } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

const settingsSchema = {
  properties: {
    permanent: { type: "boolean", description: "Answer with 301 (moved permanently) instead of the temporary 302." },
  },
};

/** Targets that follow the tree instead of naming a node; stored as the text value. */
const relatives: Record<string, (page: Node) => Promise<Node | undefined>> = {
  "__parent__": (page) => page.parent(),
  "__first-child__": async (page) => (await readablePages(page))[0],
  "__last-child__": async (page) => (await readablePages(page)).at(-1),
};

async function readablePages(page: Node): Promise<Node[]> {
  const pages = [];
  for (const child of (await page.children({ type: "p" })).values()) if (await child.isReadable()) pages.push(child);
  return pages;
}

/** Stored value → target. `node` stays empty for external URLs. */
async function resolve(cont: Node, value: string, ctx: Ctx): Promise<{ url?: string; node?: Node }> {
  if (/\s/.test(value)) return {}; // no url holds whitespace, and CR/LF must never reach the header
  const relative = relatives[value];
  if (relative) {
    const page = await relative(await cont.page());
    return page?.exists() ? { url: await page.url(), node: page } : {};
  }
  if (/^\/(?![/\\])/.test(value)) return { url: value }; // own document root — "//host" is not one
  const ret: { node?: Node } = {};
  const url = await cont.cms.url(value.replace(/^cmspid:\/\//, ""), ret);
  return url && URL.canParse(url, ctx.req.url.href) ? { url, node: ret.node } : {}; // a typo must not throw mid-render
}

/** The target is the page we are already answering — following it would loop. */
function isSelf(url: string, ctx: Ctx): boolean {
  const here = ctx.req.url.toURL();
  const there = new URL(url, here);
  here.hash = there.hash = ""; // a content target only adds a fragment, the request never carries one
  return here.href === there.href;
}

async function render(node: Node, { ctx }: { ctx: Ctx }): Promise<HtmlString | string> {
  // The posted form only, not the render vars: those may come from an api caller.
  const posted = node.edit ? postedVars(node.id) : undefined;
  if (posted && "save" in posted) await store(node, ctx, posted);

  const text = (await node.texts())._redirect; // read-only: an unconfigured node stays row-free
  const value = String(text ? await text.string(ctx.lang) : "").replace(/<[^>]*>/g, "").trim();
  const { url, node: target } = value ? await resolve(node, value, ctx) : {};
  const loop = !!url && isSelf(url, ctx);

  if (!node.edit) {
    if (loop) console.warn(`[cms.cont.redirect] node ${node.id} points at its own page`);
    else if (url) {
      ctx.res.headers.set("Location", url);
      ctx.res.status = node.settings.permanent() ? 301 : 302;
    }
    return "";
  }
  return editBox(node, ctx, { value, url, target, loop });
}

/** Store the posted target for the current language; the select only offers known relatives. */
async function store(node: Node, ctx: Ctx, vars: Record<string, unknown>): Promise<void> {
  const mode = String(vars.mode ?? "url");
  const value = mode === "url" ? String(vars.target ?? "").trim() : (mode in relatives ? mode : "");
  await node.text("_redirect", ctx.lang, value);
}

async function editBox(node: Node, ctx: Ctx, state: { value: string; url?: string; target?: Node; loop: boolean }): Promise<HtmlString> {
  const t = node.app.t;
  const { value, url, target, loop } = state;
  const mode = value in relatives ? value : "url";

  const labels: Record<string, string> = {
    "url": await t`Page or URL`,
    "__parent__": await t`Parent page`,
    "__first-child__": await t`First subpage`,
    "__last-child__": await t`Last subpage`,
  };
  const options = Object.entries(labels).map(([key, label]) =>
    html`<option value="${key}"${key === mode ? html.raw(" selected") : ""}>${label}`
  );

  const title = target ? String(await target.showTitle()).replace(/<[^>]*>/g, "").trim() : "";
  const status = !value
    ? html.async`<u2-alert open variant=warning>${t`No target defined yet.`}</u2-alert>`
    : !url
    ? html.async`<u2-alert open variant=warning>${t`This target cannot be resolved:`} ${value}</u2-alert>`
    : loop
    ? html.async`<u2-alert open variant=warning>${t`The target is this page itself — visitors would loop.`}</u2-alert>`
    : html.async`<p><a href="${url}">${t`Go to`}: ${title || url}</a>`;

  return html.async`<div class=qgCMS>
  <h2>${t`Redirect`}</h2>
  <form method=post>
    ${node.cms.formFields(node)}
    <select name=mode>${options}</select>
    <input type=qgcms-page name=target value="${mode === "url" ? value : ""}" placeholder="${t`page or URL`}">
    <button name=save>${t`ok`}</button>
  </form>
  ${status}
  <p>${t`The target is language-specific`} (${ctx.lang}).
  <p>${t`Only editors see this box, visitors are forwarded right away.`}
</div>`;
}

export const cms = {
  node: {
    render,
    settingsSchema,
  },
};
