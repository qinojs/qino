import { html } from "@qino/qino";
import { manifest } from "@qino/qino/webapp";

import type { Ctx, HtmlString } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

const safeColor = (value: unknown, fallback: string) => {
  const color = String(value ?? "").trim();
  return /^(?:#[\da-f]{3,8}|[a-z]+)$/i.test(color) ? color : fallback;
};

const value = (data: Record<string, unknown>, name: string) => String(data[name] ?? "");

/** Sandboxed home-screen, launch-screen and loaded-app simulation. */
export async function preview(node: Node, ctx: Ctx): Promise<HtmlString> {
  const app = node.app;
  const t = app.t;
  const data = await manifest(ctx);
  const identity = app.settings.identity;
  const settings = app.settings.webapp;
  const icon = Array.isArray(data.icons) ? data.icons[0] as Record<string, unknown> | undefined : undefined;
  const iconSrc = String(icon?.src ?? "");
  const name = value(data, "name");
  const shortName = value(data, "short_name");
  const description = value(data, "description");
  const startUrl = value(data, "start_url") || ".";
  const telephone = String(await identity.contact.telephone ?? "").trim() || "+41 44 123 45 67";
  const theme = safeColor(data.theme_color, "Highlight");
  const background = safeColor(data.background_color, "Canvas");
  const telephoneDetection = !!await settings.telephoneDetection;
  const statusBar = String(await settings.appleStatusBarStyle ?? "");
  const time = new Intl.DateTimeFormat(ctx.lang, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date());
  const iconHtml = iconSrc ? html`<img src="${iconSrc}" alt="">` : html`<span aria-hidden=true>◇</span>`;
  const doc = String(await html.async`<!doctype html>
<html lang="${ctx.lang}">
<meta charset=utf-8>
<meta name=viewport content="width=device-width">
<title>${name}</title>
<style>
  :root { color-scheme:light dark; font-family:system-ui,sans-serif; }
  * { box-sizing:border-box; }
  body { margin:0; min-height:100vh; display:grid; grid-template-rows:auto 1fr; place-items:center; gap:1rem; padding:1rem; background:Canvas; color:CanvasText; overflow:hidden; }
  body > .-mode { position:absolute; width:1px; height:1px; clip-path:inset(50%); }
  body > .-modes { display:flex; justify-content:center; }
  body > .-modes > label { padding:.45rem .8rem; border:1px solid color-mix(in srgb,CanvasText 30%,transparent); cursor:pointer; }
  body > .-modes > label + label { border-left:0; }
  #preview-home:checked ~ .-modes > label[for=preview-home],
  #preview-starts:checked ~ .-modes > label[for=preview-starts],
  #preview-loaded:checked ~ .-modes > label[for=preview-loaded] { background:Highlight; color:HighlightText; }
  .WebAppPreview { position:relative; width:min(26rem,calc(100vw - 2rem)); aspect-ratio:9/16; overflow:hidden; border:1px solid color-mix(in srgb,CanvasText 25%,transparent); border-radius:1.8rem; }
  .WebAppPreview > .-scene { position:absolute; inset:0; opacity:0; overflow:hidden; }
  .WebAppPreview .-status { min-height:1.5rem; display:flex; justify-content:space-between; align-items:center; padding:.1rem 1rem; font-size:.75rem; font-weight:600; }
  .WebAppPreview .-icon { display:grid; place-items:center; overflow:hidden; }
  .WebAppPreview .-icon > img { width:100%; height:100%; object-fit:contain; }
  .WebAppPreview .-icon > span { font-size:2.8rem; }
  .WebAppPreview > .-home { background:Canvas; }
  .WebAppPreview > .-home > .-apps { height:calc(100% - 1.5rem); display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); align-content:center; gap:1.5rem .7rem; padding:2rem 1rem; }
  .WebAppPreview > .-home > .-apps > .-app { min-width:0; display:grid; justify-items:center; gap:.35rem; text-align:center; font-size:.75rem; }
  .WebAppPreview > .-home > .-apps > .-app > .-icon,
  .WebAppPreview > .-home > .-apps > .-app > .-system { width:4.2rem; aspect-ratio:1; }
  .WebAppPreview > .-home > .-apps > .-app > .-system { display:grid; place-items:center; border:1px solid color-mix(in srgb,CanvasText 25%,transparent); border-radius:1rem; font-size:2rem; }
  .WebAppPreview > .-home > .-apps > .-app > span { width:100%; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .WebAppPreview > .-home > small { position:absolute; inset:auto 1rem 1rem; text-align:center; opacity:.7; }
  .WebAppPreview > .-splash { display:grid; grid-template-rows:auto 1fr; background:var(--background); }
  .WebAppPreview > .-splash > .-launch { display:grid; place-content:center; justify-items:center; gap:.9rem; padding:2rem; }
  .WebAppPreview > .-splash > .-launch > .-icon { width:7rem; aspect-ratio:1; }
  .WebAppPreview > .-splash > .-launch > strong { font-size:1.3rem; text-align:center; }
  .WebAppPreview > .-splash > .-launch > small { max-width:16rem; text-align:center; opacity:.7; }
  .WebAppPreview > .-page { display:grid; grid-template-rows:auto auto 1fr; background:Canvas; }
  .WebAppPreview > .-page > .-bar { display:flex; align-items:center; gap:.45rem; min-height:3rem; padding:.45rem .7rem; background:var(--theme); }
  .WebAppPreview > .-page > .-bar > .-favicon { width:1.55rem; aspect-ratio:1; display:grid; place-items:center; overflow:hidden; flex:none; }
  .WebAppPreview > .-page > .-bar > .-favicon img { width:100%; height:100%; object-fit:contain; }
  .WebAppPreview > .-page > .-bar > .-address { min-width:0; flex:1; padding:.42rem .6rem; overflow:hidden; border-radius:1rem; background:color-mix(in srgb,Canvas 92%,transparent); color:CanvasText; font-size:.72rem; text-overflow:ellipsis; white-space:nowrap; }
  .WebAppPreview > .-page > .-content { height:100%; min-height:0; padding:2rem 1.4rem; background:Canvas; }
  .WebAppPreview > .-page > .-content h1 { margin:0 0 .5rem; }
  .WebAppPreview > .-page > .-content p { max-width:30rem; }
  .WebAppPreview > .-page > .-content > .-contact { margin-top:2rem; padding-top:1rem; border-top:1px solid color-mix(in srgb,CanvasText 20%,transparent); }
  .WebAppPreview > .-page > .-content > .-contact .-detected { color:LinkText; text-decoration:underline; }
  body[data-telephone=true] .WebAppPreview .-phone > .-plain,
  body[data-telephone=false] .WebAppPreview .-phone > .-detected { display:none; }
  body[data-display=standalone] .WebAppPreview > .-page > .-bar,
  body[data-display=fullscreen] .WebAppPreview > .-page > .-bar { display:none; }
  body[data-display=fullscreen] .WebAppPreview .-status { display:none; }
  body[data-display=fullscreen] .WebAppPreview > .-home > .-apps { height:100%; }
  body[data-display=minimal-ui] .WebAppPreview > .-page > .-bar { min-height:2rem; padding-block:.25rem; }
  body[data-display=minimal-ui] .WebAppPreview > .-page > .-bar > .-address { padding-block:.28rem; }
  body[data-status-bar=black] .WebAppPreview .-status { background:#000; color:#fff; }
  body[data-status-bar=black-translucent] .WebAppPreview .-status { background:#0008; color:#fff; }
  body[data-orientation^=landscape] .WebAppPreview { width:min(44rem,calc(100vw - 2rem)); aspect-ratio:16/9; }
  .WebAppPreview.-run > .-home { animation:home 12s infinite; }
  .WebAppPreview.-run > .-splash { animation:splash 12s infinite; }
  .WebAppPreview.-run > .-page { animation:page 12s infinite; }
  body > .-mode:checked ~ .WebAppPreview > .-scene { animation:none; opacity:0; }
  #preview-home:checked ~ .WebAppPreview > .-home,
  #preview-starts:checked ~ .WebAppPreview > .-splash,
  #preview-loaded:checked ~ .WebAppPreview > .-page { opacity:1; }
  @keyframes home { 0%,22% { opacity:1; } 26%,100% { opacity:0; } }
  @keyframes splash { 0%,22% { opacity:0; } 26%,42% { opacity:1; } 46%,100% { opacity:0; } }
  @keyframes page { 0%,42% { opacity:0; } 46%,96% { opacity:1; } 100% { opacity:0; } }
  @media (prefers-reduced-motion:reduce) {
    .WebAppPreview.-run > .-home,.WebAppPreview.-run > .-splash { animation:none; }
    .WebAppPreview.-run > .-page { animation:none; opacity:1; }
  }
</style>
<body data-display="${data.display}" data-orientation="${data.orientation}" data-telephone="${telephoneDetection}" data-status-bar="${statusBar}" style="--theme:${theme};--background:${background}">
<input class=-mode type=radio name=preview id=preview-home>
<input class=-mode type=radio name=preview id=preview-starts>
<input class=-mode type=radio name=preview id=preview-loaded>
<nav class=-modes aria-label="${t`Preview stage`}">
  <label for=preview-home>${t`Home`}</label>
  <label for=preview-starts>${t`Starts`}</label>
  <label for=preview-loaded>${t`Loaded`}</label>
</nav>
<main class="WebAppPreview -run" aria-label="${t`Application preview`}">
  <section class="-scene -home" data-webapp-scene=home aria-label="${t`Home screen`}">
    <div class=-status aria-label="${t`Status bar`}"><span data-webapp-time>${time}</span><span aria-hidden=true>● ◒ ▰</span></div>
    <div class=-apps>
      <div class=-app><div class=-system aria-hidden=true>☎</div><span>${t`Phone`}</span></div>
      <div class=-app><div class=-system aria-hidden=true>✉</div><span>${t`Messages`}</span></div>
      <div class=-app><div class=-system aria-hidden=true>◉</div><span>${t`Camera`}</span></div>
      <div class=-app><div class=-system aria-hidden=true>⚙</div><span>${t`Settings`}</span></div>
      <div class=-app><div class=-system aria-hidden=true>◎</div><span>${t`Browser`}</span></div>
      <div class=-app><div class=-icon>${iconHtml}</div><span>${shortName}</span></div>
    </div>
    <small>${t`The operating system determines the icon mask and home-screen background.`}</small>
  </section>
  <section class="-scene -splash" data-webapp-scene=splash aria-label="${t`Launch screen`}">
    <div class=-status aria-label="${t`Status bar`}"><span data-webapp-time>${time}</span><span aria-hidden=true>● ◒ ▰</span></div>
    <div class=-launch>
      <div class=-icon>${iconHtml}</div>
      <strong>${name}</strong>
      <small>${t`Generated only when the browser and icon satisfy its splash-screen requirements.`}</small>
    </div>
  </section>
  <section class="-scene -page" data-webapp-scene=page aria-label="${t`Loaded application`}">
    <div class=-status aria-label="${t`Status bar`}"><span data-webapp-time>${time}</span><span aria-hidden=true>● ◒ ▰</span></div>
    <div class=-bar>
      <div class=-favicon>${iconHtml}</div>
      <div class=-address>${ctx.req.url.host}${startUrl}</div>
    </div>
    <article class=-content>
      <h1>${name}</h1>
      ${description ? html`<p>${description}</p>` : html.async`<p>${t`This is a simulated page inside the installed application.`}</p>`}
      <div class=-contact>
        <strong>${t`Call us`}</strong>
        <div class=-phone><span class=-detected>${telephone}</span><span class=-plain>${telephone}</span></div>
      </div>
    </article>
  </section>
</main>`);
  return html`<iframe data-webapp-preview title="${await t`Application preview`}" sandbox=allow-same-origin srcdoc="${doc}" style="width:100%;height:65rem;border:0"></iframe>`;
}
