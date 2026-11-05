import { hee, html } from "@qino/qino";

import type { Ctx } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

async function init(node: Node) {
  if (node.settings.__inited() || !await node.edit()) return;
  node.settings.__inited(true);
  const page = await node.page();
  for (const lang of node.app.languages.all) {
    const title = await page.title(lang);
    if (title) await node.title(lang, title);
  }
  const form = await node.cont("comments", "cms.cont.form");
  form.settings.__inited(true);
  await form.text("button_submit", "en", "Post comment");
  await form.text("button_submit", "de", "Kommentar absenden");
  const fields = await form.cont("main", "cms.cont.form.fields");
  for (const [name, type, autocomplete] of [["name", "text", "name"], ["email", "email", "email"], ["comment", "textarea", ""]]) {
    await fields.settings.fields[name]({ type, required: true, ...(autocomplete && { autocomplete }) });
    await fields.text(name + "_title", "en", name === "comment" ? "Comment" : name[0].toUpperCase() + name.slice(1));
    await fields.text(name + "_title", "de", name === "comment" ? "Kommentar" : name === "name" ? "Name" : "E-Mail");
  }
  await fields.settings.field_order("name,email,comment");
  const success = await form.cont("success", "cms.cont.text");
  await success.text("main", "en", "<p>Thank you. Your comment will appear after review.</p>");
  await success.text("main", "de", "<p>Vielen Dank. Ihr Kommentar erscheint nach der Freigabe.</p>");
  const entries = await node.cont("entries", "cms.cont.form.entries");
  await entries.settings({ form: form.id, moderated: true, show_fields: "name,comment" });
  await form.settings.listing_nodes({ [entries.id]: true });
}

async function renderContent(node: Node, { ctx }: { ctx: Ctx }) {
  await init(node);
  const page = await node.page();
  const title = (await page.showTitle()).plain();
  const canonical = new URL(ctx.req.appUrl + await page.urlSeo(ctx.lang), await node.app.url()).href;
  const description = ctx.res.html.meta.description;
  ctx.res.html.head += `<link rel="canonical" href="${hee(canonical)}"><meta property="og:type" content="article"><meta property="og:title" content="${hee(title)}"><meta property="og:url" content="${hee(canonical)}">${description ? `<meta property="og:description" content="${hee(description)}">` : ""}\n`;
  const published = Number(page.vs.online_start);
  if (published) ctx.res.html.head += `<meta property="article:published_time" content="${new Date(published * 1000).toISOString()}">\n`;

  const children = await node.conts();
  const form = children.find((child) => child.vs.name === "comments");
  const entries = children.find((child) => child.vs.name === "entries");
  return html.async`<article class=u2-width>
    <header>${await node.edit() || (await node.showTitle()).plain() ? node.cms.text(node, "title", { tag: "h1" }) : html`<h1>${title}</h1>`}${published ? html`<time datetime="${new Date(published * 1000).toISOString()}">${new Date(published * 1000).toLocaleDateString(ctx.lang || undefined)}</time>` : ""}</header>
    ${node.cms.text(node, "main")}
    ${entries ? html.async`<section><h2>${node.app.t`Comments`}</h2>${entries.html()}</section>` : ""}
    ${form ? html.async`<section><h2>${node.app.t`Leave a comment`}</h2>${form.html()}</section>` : ""}
  </article>`;
}

function render(node: Node, args: { ctx: Ctx }) {
  return node.app.languages.with({ ns: "cms.cont.blog.post" }, () => renderContent(node, args));
}

export const cms = { node: { render, css: ["pub/main.css"] } };
