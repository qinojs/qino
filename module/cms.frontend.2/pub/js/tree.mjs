/* Copyright (c) 2016 Tobias Buschor https://goo.gl/gl0mbf | MIT License https://goo.gl/HgajeK */
/* Tree-Engine-Switch.
 *   Default:     dynatree  (jQuery, bewährt)        -> tree.dynatree.mjs
 *   Alternative: wunderbaum (vanilla ESM, kein jQuery) -> tree.wunderbaum.mjs
 *
 * Umschalten (pro Browser, kein Deploy nötig):
 *   localStorage.cmsTreeEngine = 'wunderbaum'   // bzw. 'dynatree'
 *   oder ?tree=wunderbaum in der URL
 * Zurück zu dynatree: localStorage.removeItem('cmsTreeEngine')
 */
const engine =
  new URLSearchParams(location.search).get("tree") ||
  localStorage.getItem("cmsTreeEngine") ||
  "dynatree";

await import(engine === "wunderbaum" ? "./tree.wunderbaum.mjs" : "./tree.dynatree.mjs");
