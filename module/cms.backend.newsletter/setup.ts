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

/** The brand colour, else a calm violet. */
const ACCENT = "{{identity.brand.primaryColor|#6d4aff}}";
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

/**
 * A whole mail document. The layout is tables with inline styles in px, so Outlook (Word engine)
 * shows a clean card; the style block adds what modern clients render — rounded corners, shadow,
 * type for the editor's content, a narrow screen. The site's identity fills it: logo, name,
 * colour, address; the footer carries the way out.
 */
export async function starter(app: App): Promise<string> {
  const t = app.t;
  const [hello, why] = await Promise.all([t`Hello {{givenName|there}}`, t`You receive this newsletter because you subscribed to it.`]);
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<style>
  body { margin:0; padding:0; background:#f1f0f5; -webkit-text-size-adjust:100%; }
  .card { border-radius:14px; overflow:hidden; box-shadow:0 2px 12px rgba(24,24,40,.08); }
  .content h1, .content h2, .content h3 { margin:28px 0 10px; line-height:1.25; color:#18181b; font-weight:700; }
  .content h1 { font-size:28px; } .content h2 { font-size:22px; } .content h3 { font-size:18px; }
  .content p { margin:0 0 16px; }
  .content ul, .content ol { margin:0 0 16px; padding-left:22px; }
  .content li { margin:0 0 6px; }
  .content a { color:${ACCENT}; text-decoration:underline; }
  .content img { max-width:100%; height:auto; border:0; border-radius:10px; }
  .content blockquote { margin:0 0 16px; padding:4px 0 4px 16px; border-left:3px solid ${ACCENT}; color:#52525b; }
  .content hr { border:0; border-top:1px solid #e7e5ee; margin:28px 0; }
  .content > :first-child { margin-top:0; }
  .brand img { height:52px; width:auto; } /* Outlook keeps the placeholder's 40px */
  .foot a { color:#71717a; text-decoration:underline; }
  @media (max-width:620px) {
    .outer { padding:0 !important; }
    .wrap { width:100% !important; }
    .card { border-radius:0 !important; }
    .pad { padding-left:22px !important; padding-right:22px !important; }
  }
</style>
</head>
<body style="margin:0;padding:0;background:#f1f0f5">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f1f0f5">
<tr><td align="center" class="outer" style="padding:32px 12px">
  <table role="presentation" class="wrap card" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:100%;background:#ffffff">
    <tr><td style="height:6px;line-height:6px;font-size:0;background:${ACCENT}">&nbsp;</td></tr>
    <tr><td class="pad brand" style="padding:32px 44px 4px;font-family:${FONT}">
      {{identity.brand.logo}}
      <div style="margin-top:10px;font-size:15px;font-weight:700;letter-spacing:.02em;color:#18181b">{{identity.name}}</div>
    </td></tr>
    <tr><td class="pad content" style="padding:20px 44px 36px;font-family:${FONT};font-size:16px;line-height:1.65;color:#3f3f46">
      <p style="margin:0 0 16px">${hello}</p>
      {{content}}
    </td></tr>
  </table>
  <table role="presentation" class="wrap" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:100%">
    <tr><td class="pad foot" align="center" style="padding:22px 44px 8px;font-family:${FONT};font-size:12px;line-height:1.6;color:#71717a">
      <p style="margin:0 0 8px">${why} {{unsubscribe}}</p>
      <p style="margin:0">{{identity.organization.address.formatted}}</p>
    </td></tr>
  </table>
</td></tr>
</table>
</body>
</html>`;
}
