export const name = "cms.legacy.c1";
export const description = "Serves the PHP-era c1 browser helpers for a migrated site's own scripts.";
export const needs = ["core"];

// Assets only, no render. qino ships a trimmed core/pub/js/c1.js that no longer carries `c1Use`,
// `c1.dom` or `c1.scroll`, but a migrated site's own JS still calls them. The originals live under
// pub/ and a site loads them from its layout template:
//
//   resHtml.legacyScripts.add(ctx.req.moduleUrl + "cms.legacy.c1/pub/c1.js");
//   resHtml.legacyScripts.add(ctx.req.moduleUrl + "cms.legacy.c1/pub/c1/dom.js");
//
// c1.js must come first — the others attach to it.
