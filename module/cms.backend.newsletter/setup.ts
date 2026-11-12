import { saveTemplate, template } from "@qino/qino/messaging";

import type { App } from "@qino/qino";

// What a fresh install brings, so the first newsletter needs no setup: a list and a template.

export const TYPE = "newsletter";
export const CHANNEL = "email";

/** A list, if there is none, and the newsletter template, if it is missing. Never overwrites. */
export async function setup(app: App): Promise<void> {
  const t = app.t;
  if (!await app.db.one`SELECT id FROM grp WHERE type = ${TYPE} LIMIT 1`) {
    await app.db.table("grp").insert({ name: await t`Newsletter`, type: TYPE });
  }
  if (!await template(app, CHANNEL, TYPE)) {
    await saveTemplate(app, { name: TYPE, channel: CHANNEL, main: false, format: "html", text: await starter(app) });
  }
}

/**
 * Mail html, as clients render it: tables, inline styles in px, 600px wide. The site's identity
 * fills it — logo, name, colour, address — and the footer carries the way out.
 */
export async function starter(app: App): Promise<string> {
  const t = app.t;
  const [hello, why] = await Promise.all([t`Hello {{givenName|there}}`, t`You receive this newsletter because you subscribed to it.`]);
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5">
<tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:100%;background:#ffffff;border-top:4px solid {{identity.brand.primaryColor|#3f3f46}};font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.5;color:#27272a">
<tr><td style="padding:24px 32px 0">{{identity.logo}}<div style="font-size:20px;font-weight:bold">{{identity.name}}</div></td></tr>
<tr><td style="padding:16px 32px 24px">
<p>${hello}</p>
{{content}}
</td></tr>
<tr><td style="padding:16px 32px 24px;border-top:1px solid #e4e4e7;font-size:12px;color:#71717a">
<p style="margin:0 0 8px">${why} {{unsubscribe}}</p>
<p style="margin:0">{{identity.name}}<br>{{identity.organization.address.formatted}}</p>
</td></tr>
</table>
</td></tr>
</table>`;
}
