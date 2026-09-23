
// Assets only. qino's core/pub/js/c1.js is ESM without a global `c1`, but migrated site JS still
// uses `c1`, `c1Use`, `c1.dom` or `c1.scroll`. The originals are in pub/; load them in the layout:
//
//   resHtml.legacyScripts.add(ctx.req.moduleUrl + "cms.legacy.c1/pub/c1.js");
//   resHtml.legacyScripts.add(ctx.req.moduleUrl + "cms.legacy.c1/pub/c1/dom.js");
//
// c1.js must come first — the others attach to it.
