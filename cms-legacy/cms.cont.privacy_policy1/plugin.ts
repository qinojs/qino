import { html, sql } from "@qino/qino";

import { cmsText } from "../lib/text.ts";

import type { Ctx, HtmlString } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

async function render(node: Node, { ctx }: { ctx: Ctx }): Promise<HtmlString> {
  const heading = [1, 2, 3, 4].includes(Number(await node.settings.Heading)) ? Number(await node.settings.Heading) : 2;
  const texts = await node.texts();
  const sections: HtmlString[] = [];
  const preferred = ["accountable_body", "revocation", "grievance", "data_portability", "your_data", "https", "logs", "contactform", "youtube", "google_fonts", "cookies"];
  const available = texts.keys().filter((name) => name.startsWith("content_")).map((name) => name.slice(8)).toArray();
  const keys = [...preferred.filter((key) => available.includes(key)), ...available.filter((key) => !preferred.includes(key))];
  for (const key of keys) {
    if (key === "https" && ctx.req.url.protocol !== "https:") continue;
    if (key === "google_fonts") {
      let font = "";
      try {
        font = String(await node.db.one`SELECT value FROM ${sql.id("qg_setting")} WHERE ${sql.id("offset")} = ${"font-css-file"}` ?? "");
      } catch {/**/}
      try {
        if (new URL(font).hostname !== "fonts.googleapis.com") continue;
      } catch { continue; }
    }
    const name = "content_" + key;
    if (!texts.has("title_" + key)) continue;
    let owner: HtmlString | string = "";
    if (key === "accountable_body") {
      const fields = ["company", "name", "address"];
      const lines = [];
      for (const field of fields) {
        const value = String(await node.app.settings.app1.owner[field] ?? "").trim();
        if (value) lines.push(value);
      }
      const place = [String(await node.app.settings.app1.owner.zip ?? "").trim(), String(await node.app.settings.app1.owner.city ?? "").trim()].filter(Boolean).join(" ");
      if (place) lines.push(place);
      if (lines.length) owner = html`<p style="margin:1em 0">${html.join(lines.map((line) => html`${line}<br>`))}</p>`;
    }
    if (key === "logs" && await node.app.settings["cms.cont.privacy_policy1"]["anonymize IP"])
      owner = html`<p>IP-Adressen sind anonymisiert.</p>`;
    sections.push(await html.async`<div class=-section>
  ${cmsText(node, "title_" + key, "h" + heading)}
  ${cmsText(node, name)}
  ${owner}
</div>`);
  }
  return html`<div><div thm1-width class="u1-width u2-width">
  ${await cmsText(node, "title", "h1")}
  ${html.join(sections)}
  <p><small>Quelle: Datenschutz-Konfigurator von <a href="http://www.mein-datenschutzbeauftragter.de" target=_blank>mein-datenschutzbeauftragter.de</a></small></p>
</div></div>`;
}

export const cms = { node: { render } };
