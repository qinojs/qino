// cms.cont.nav3 is a faithful port of this module and keeps every setting name
// (startPage, startLevel, filter_visible, level, pathOnly, "include contents"),
// so the legacy name only needs to point at it.
export { cms } from "../../module/cms.cont.nav3/plugin.ts";

export const name = "cms.cont.nav2";
export const description = "Legacy navigation of the PHP CMS; renders through cms.cont.nav3.";
export const needs = ["cms"];
