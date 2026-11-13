import type { Ctx } from "@qino/qino";

/** Adds structured data (schema.org JSON-LD) to the document, indented in dev mode; `<` is escaped,
 *  so it can't end the element. */
export function jsonLd(ctx: Ctx, data: Record<string, unknown>): void {
  const json = JSON.stringify({ "@context": "https://schema.org", ...data }, null, ctx.dev ? 2 : 0).replace(/</g, "\\u003c");
  ctx.res.html.head += `<script type=application/ld+json>${json}</script>\n`;
}
