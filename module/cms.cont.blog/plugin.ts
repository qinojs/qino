import { hee, html, Output } from "@qino/qino";
import { cms as cmsOf } from "@qino/qino/cms";

import type { App, Ctx } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

const LIMIT = 20;

async function descriptionOf(node: Node) {
  return (await node.texts()).has("_meta_description")
    ? (await node.showText("_meta_description")).plain() : "";
}

async function posts(node: Node, publicOnly: boolean, { offset = 0, limit = LIMIT, dated = false } = {}) {
  const page = await node.page();
  const children = [...(await page.children({ type: "p" })).values()]
    .sort((a, b) => (Number(b.vs.online_start) || 0) - (Number(a.vs.online_start) || 0) || b.id - a.id);

  const out = [];
  let skipped = 0;
  for (const child of children) {
    if (publicOnly && (!await child.isPublic() || !await child.isOnline() || !child.vs.searchable)) continue;
    if (!publicOnly && !await child.isReadable()) continue;
    const created = Number(child.vs.online_start) || 0;
    if (dated && !created) continue;
    const title = (await child.showTitle()).plain();
    if (!title) continue;
    if (skipped++ < offset) continue;
    out.push({ node: child, title, created });
    if (out.length >= limit) break;
  }
  return out;
}

function feedUrl(node: Node, canonical: string, format: "atom" | "rss") {
  const url = new URL(canonical);
  url.searchParams.set("cms_blog", String(node.id));
  if (format === "rss") url.searchParams.set("cms_blog_format", "rss");
  return url.href;
}

function pageUrl(canonical: string, page: number) {
  const url = new URL(canonical);
  if (page > 1) url.searchParams.set("cms_blog_page", String(page));
  return url.href;
}

async function renderContent(node: Node, { ctx }: { ctx: Ctx }) {
  const page = await node.page();
  const title = (await page.showTitle()).plain();
  const base = new URL(ctx.req.appUrl + await page.urlSeo(ctx.lang), await node.app.url()).href;
  const asked = Number(ctx.req.query.cms_blog_page);
  const pageNo = Number.isSafeInteger(asked) && asked > 0 ? asked : 1;
  const canonical = pageUrl(base, pageNo);
  if (pageNo > 1) {
    for (const [url, attrs] of Object.entries(ctx.res.html.link)) {
      if (attrs.rel !== "alternate" || !attrs.hreflang) continue;
      delete ctx.res.html.link[url];
      ctx.res.html.link[pageUrl(url, pageNo)] = attrs;
    }
  }
  const description = ctx.res.html.meta.description;
  const atom = feedUrl(node, base, "atom"), rss = feedUrl(node, base, "rss");
  ctx.res.html.link[atom] = { rel: "alternate", type: "application/atom+xml", title };
  ctx.res.html.link[rss] = { rel: "alternate", type: "application/rss+xml", title };
  ctx.res.html.head += `<link rel="canonical" href="${hee(canonical)}"><meta property="og:type" content="website"><meta property="og:title" content="${hee(title)}"><meta property="og:url" content="${hee(canonical)}">${description ? `<meta property="og:description" content="${hee(description)}">` : ""}\n`;

  const edit = await node.edit();
  const heading = edit || (await node.showTitle()).plain() ? node.cms.text(node, "title", { tag: "h1" }) : "";
  const items = [];
  const found = await posts(node, !edit, { offset: (pageNo - 1) * LIMIT, limit: LIMIT + 1 });
  for (const post of found.slice(0, LIMIT)) {
    const excerpt = await descriptionOf(post.node);
    const url = await post.node.url();
    items.push(html`<article>
      <h2><a href="${url}">${post.title}</a></h2>
      ${post.created ? html`<time datetime="${new Date(post.created * 1000).toISOString()}">${new Date(post.created * 1000).toLocaleDateString(ctx.lang || undefined)}</time>` : ""}
      ${excerpt ? html`<p>${excerpt}</p>` : ""}
    </article>`);
  }
  return html.async`<div class=u2-width>${heading}${items}
    ${pageNo > 1 || found.length > LIMIT ? html.async`<nav aria-label="${node.app.t`Blog pages`}">
      ${pageNo > 1 ? html.async`<a href="${pageUrl(base, pageNo - 1)}" rel=prev>${node.app.t`Newer posts`}</a>` : ""}
      ${found.length > LIMIT ? html.async`<a href="${pageUrl(base, pageNo + 1)}" rel=next>${node.app.t`Older posts`}</a>` : ""}
    </nav>` : ""}
  </div>`;
}

function render(node: Node, args: { ctx: Ctx }) {
  return node.app.languages.with({ ns: "cms.cont.blog" }, () => renderContent(node, args));
}

async function feed(node: Node, ctx: Ctx, format: "atom" | "rss") {
  const page = await node.page();
  if (!await node.isPublic() || !await node.isOnline() || !await page.isPublic() || !await page.isOnline())
    throw new Output("Not Found", { status: 404 });

  const title = (await page.showTitle()).plain();
  const canonical = new URL(ctx.req.appUrl + await page.urlSeo(ctx.lang), await node.app.url()).href;
  const entries = [];
  for (const post of await posts(node, true, { dated: true })) {
    entries.push({
      title: post.title,
      url: new URL(ctx.req.appUrl + await post.node.urlSeo(ctx.lang), await node.app.url()).href,
      summary: await descriptionOf(post.node),
      date: new Date(post.created * 1000).toISOString(),
    });
  }
  let body: string;
  if (format === "atom") {
    const updated = entries[0]?.date ?? new Date(Number(page.vs.online_start) * 1000 || 0).toISOString();
    const items = entries.map((entry) => `<entry>
      <title>${hee(entry.title)}</title><id>${hee(entry.url)}</id>
      <link href="${hee(entry.url)}"/><published>${entry.date}</published><updated>${entry.date}</updated>
      <summary>${hee(entry.summary)}</summary>
    </entry>`).join("");
    body = `<?xml version="1.0" encoding="utf-8"?>
      <feed xmlns="http://www.w3.org/2005/Atom" xml:lang="${hee(ctx.lang)}">
        <title>${hee(title)}</title><id>${hee(canonical)}</id>
        <author><name>${hee(title)}</name></author>
        <link href="${hee(canonical)}"/><link rel="self" href="${hee(feedUrl(node, canonical, format))}"/>
        <updated>${updated}</updated>${items}
      </feed>`;
  } else {
    const items = entries.map((entry) => `<item>
      <title>${hee(entry.title)}</title><link>${hee(entry.url)}</link>
      <guid isPermaLink="true">${hee(entry.url)}</guid>
      <pubDate>${new Date(entry.date).toUTCString()}</pubDate>
      <description>${hee(entry.summary)}</description>
    </item>`).join("");
    body = `<?xml version="1.0" encoding="utf-8"?>
      <rss version="2.0"><channel>
        <title>${hee(title)}</title><link>${hee(canonical)}</link>
        <description>${hee(await descriptionOf(page))}</description><language>${hee(ctx.lang)}</language>${items}
      </channel></rss>`;
  }
  throw new Output(body, { headers: { "Content-Type": `application/${format === "atom" ? "atom" : "rss"}+xml; charset=utf-8` } });
}

export function init(app: App, { signal }: { signal: AbortSignal }) {
  app.on("route", async ({ ctx }) => {
    const id = Number(ctx.req.query.cms_blog);
    if (!Number.isSafeInteger(id) || id < 1 || ctx.req.method !== "GET") return;
    const node = await cmsOf(app).node(id);
    if (node.vs.module !== "cms.cont.blog") throw new Output("Not Found", { status: 404 });
    await feed(node, ctx, ctx.req.query.cms_blog_format === "rss" ? "rss" : "atom");
  }, { signal });
}

export const cms = { node: { render, css: ["pub/main.css"] } };
