import { hee, html } from "@qino/qino";
import * as u2 from "@qino/qino/u2";

import type { Ctx } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

// navigator.share where the browser has none (desktop Firefox): a dialog with the usual targets
const SHARE_POLYFILL = "https://cdn.jsdelivr.net/gh/nuxodin/lazyfill@1.7.12/polyfills/navigator/share.min.js";

async function init(node: Node) {
  if (node.settings.__inited() || !await node.edit()) return;
  node.settings.__inited(true);
  const { app } = node, t = app.t;
  const page = await node.page();
  const form = await node.cont("comments", "cms.cont.form");
  form.settings.__inited(true);
  const fields = await form.cont("main", "cms.cont.form.fields");
  for (const [name, type, autocomplete] of [["name", "text", "name"], ["email", "email", "email"], ["comment", "textarea", ""]])
    await fields.settings.fields[name]({ type, required: true, ...(autocomplete && { autocomplete }) });
  await fields.settings.field_order("name,email,comment");
  const success = await form.cont("success", "cms.cont.text");
  for (const lang of app.languages.all) await app.languages.with({ ns: "cms.cont.blog.post", lang }, async () => {
    const title = await page.title(lang);
    if (title) await node.title(lang, title);
    await form.text("button_submit", lang, await t`Post comment`);
    await fields.text("name_title", lang, await t`Name`);
    await fields.text("email_title", lang, await t`Email`);
    await fields.text("comment_title", lang, await t`Comment`);
    await success.text("main", lang, `<p>${hee(await t`Thank you. Your comment will appear after review.`)}</p>`);
  });
  const entries = await node.cont("entries", "cms.cont.form.entries");
  await entries.settings({ form: form.id, moderated: true, show_fields: "name,comment" });
  await form.settings.listing_nodes({ [entries.id]: true });
}

async function renderContent(node: Node, { ctx }: { ctx: Ctx }) {
  await init(node);
  const page = await node.page();
  const title = (await page.showTitle()).plain();
  const canonical = new URL(ctx.req.appUrl + await page.urlSeo(ctx.lang), await node.app.url()).href;
  ctx.res.html.head += `<link rel="canonical" href="${hee(canonical)}">\n`;
  const published = Number(page.vs.online_start);
  const date = published && new Date(published * 1000);
  u2.assets(ctx, ["attr/behavior/behavior.js"]);
  ctx.res.html.legacyScripts.add(SHARE_POLYFILL);
  ctx.res.csp["script-src"][SHARE_POLYFILL] = true;

  const children = await node.conts();
  const form = children.find((child) => child.vs.name === "comments");
  const entries = children.find((child) => child.vs.name === "entries");
  return html.async`<article class=u2-width>
    <header>
      ${await node.edit() || (await node.showTitle()).plain()
        ? node.cms.text(node, "title", { tag: "h1" }) : html`<h1>${title}</h1>`}
      ${date ? html`<time datetime="${date.toISOString()}">
        ${date.toLocaleDateString(ctx.lang || undefined)}</time>` : ""}
      <button type=button u2-behavior=share data-url="${canonical}" data-title="${title}">
        ${node.app.t`Share`}</button>
    </header>
    ${node.cms.text(node, "main")}
    ${entries ? html.async`<section><h2>${node.app.t`Comments`}</h2>${entries.html()}</section>` : ""}
    ${form ? html.async`<section><h2>${node.app.t`Leave a comment`}</h2>${form.html()}</section>` : ""}
  </article>`;
}

function render(node: Node, args: { ctx: Ctx }) {
  return node.app.languages.with({ ns: "cms.cont.blog.post" }, () => renderContent(node, args));
}

export const cms = { node: { render, css: ["pub/main.css"] } };
