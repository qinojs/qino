import { html } from "@qino/qino";

import { identityOwner } from "../lib/identity.ts";
import { cmsText } from "../lib/text.ts";

import type { Ctx, HtmlString } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

const workers = ["Kontaktadresse", "Technische Umsetzung", "Konzept", "Design", "Fotografie"];
const fields = ["company", "name", "address", "zip", "city", "phone", "email", "website"];

async function render(node: Node, { ctx }: { ctx: Ctx }): Promise<HtmlString> {
  const heading = [1, 2, 3, 4].includes(Number(await node.settings.Heading)) ? Number(await node.settings.Heading) : 2;
  const blocks: HtmlString[] = [];
  for (const worker of workers) {
    const data: Record<string, string> = {};
    for (const field of fields) data[field] = String(await node.settings[worker][field] ?? "");
    if (worker === "Kontaktadresse" && !data.company && !data.name) {
      const owner = await identityOwner(node.app);
      for (const field of fields) data[field] = owner[field] ?? "";
      data.website ||= ctx.req.url.origin;
    }
    if (!data.company && !data.name) continue;
    const city = [data.zip, data.city].filter(Boolean).join(" ");
    const website = data.website ? (data.website.startsWith("http") ? data.website : "http://" + data.website) : "";
    blocks.push(await html.async`<div class=-block>
  <h${heading}>${worker}</h${heading}>
  <p>${data.company ? html`<span class=-company>${data.company}</span><br>` : ""}
    ${data.name ? html`<span class=-name>${data.name}</span><br>` : ""}
    ${data.address ? html`<span class=-address>${data.address}</span><br>` : ""}
    ${city ? html`<span class=-city>${city}</span><br>` : ""}
    ${data.phone ? html`<span class=-phone>${data.phone}</span><br>` : ""}
    ${data.email ? html`<span class=-email><a href="mailto:${data.email}">${data.email}</a></span><br>` : ""}
    ${website ? html`<span class=-website><a href="${website}" target=_blank>${data.website}</a></span><br>` : ""}</p>
  ${node.showText(worker + "_more")}
</div>`);
  }
  if (await node.settings.Einblenden.CMS) blocks.push(html`<div class=-block>
  ${await cmsText(node, "CMS", "h" + heading)}
  <p><a href="https://vanilla-cms.org" target=_blank>Vanilla CMS | opensource made in switzerland</a><br>
  ${ctx.lang === "en" ? "Half an hour of training and you can operate your website" : "Eine halbe Stunde Schulung und man kann seine Website bedienen"}</p>
</div>`);

  const texts = await node.texts();
  const legal: HtmlString[] = [];
  for (const name of texts.keys()) {
    if (!name.endsWith("_p") || !texts.has(name.slice(0, -2) + "_h")) continue;
    const key = name.slice(0, -2);
    if (!await node.settings.Einblenden[key]) continue;
    legal.push(await html.async`<div class=-block>${cmsText(node, key + "_h", "h" + heading)}${cmsText(node, name, "p")}</div>`);
  }
  return html`<div><div thm1-width class=u1-width>
  <div class=-contact>${blocks}</div>
  <div class=-texts>${legal}</div>
</div></div>`;
}

export const cms = { node: { render } };
