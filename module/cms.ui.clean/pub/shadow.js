/* Adopts u2 classless + unstyle + minimal Clean CMS styles into qino-cms shadow root. */

const U2_SHEETS = [
  "@qino/u2/css/classless/variables.css",
  "@qino/u2/css/classless/classless.css",
  "@qino/u2/css/classless/more.css",
  "@qino/u2/class/unstyle/unstyle.css",
  "@qino/u2/class/table/table.css",
];

async function fetchSheet(url) {
  const css = await fetch(url).then((r) => r.text());
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(css.replace(/url\((["']?)(?!data:|https?:|\/)([^"')]+)\1\)/g, (_, _q, p) => `url("${new URL(p, url)}")`));
  return sheet;
}

async function apply() {
  const host = document.querySelector("qino-cms");
  const root = host?.shadowRoot;
  if (!root || typeof host.addStyle !== "function") return;

  // Isolate panel palette from the customer page's CSS custom properties via u2's [u2-skin]
  if (!host.hasAttribute("u2-skin")) host.setAttribute("u2-skin", "");

  const u2 = await Promise.all(U2_SHEETS.map((spec) => fetchSheet(import.meta.resolve(spec))));
  // Remove legacy ui.css sheet (identifiable by --cms-background) so u2 controls aren't overwritten
  const kept = root.adoptedStyleSheets.filter((s) => {
    try { return ![...s.cssRules].some((r) => r.cssText.includes("--cms-background")); }
    catch { return true; }
  });
  // u2 base first, then cms.frontend structural sheets, then our minimal base + panel overrides
  root.adoptedStyleSheets = [...u2, ...kept];
  await host.addStyle("cms.ui.clean/pub/base.css");
  await host.addStyle("cms.ui.clean/pub/panel.css");
}

queueMicrotask(() => {
  if (document.querySelector("qino-cms")?.shadowRoot) apply();
  else customElements.whenDefined("qino-cms").then(() => requestAnimationFrame(apply));
});
