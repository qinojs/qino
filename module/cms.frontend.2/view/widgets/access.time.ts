import { html, type HtmlString } from "../../../core/mod.ts";
import type { Node } from "../../../cms/mod.ts";

function toDatetimeLocal(ts: string | number | null): string {
  if (!ts) return "";
  return new Date(Number(ts) * 1000).toISOString().slice(0, 16);
}

export default function (node: Node): Promise<HtmlString> {
  const app = node.app;
  const startVal = toDatetimeLocal(node.vs.online_start);
  const endVal   = toDatetimeLocal(node.vs.online_end);

  return html.async`<div class=access-time-manager pid=${node.id}>
  <div>
    <div style="flex:0 1 6.25rem">${app.t`visible`} ${app.t`from`}:</div>
    <div class=-accessTimeBtns>
      <button class=-start_always  ${node.vs.online_start === 0 ? "disabled" : ""}>${app.t`unlimited`}</button>
      <button class=-start_inherit ${node.vs.online_start === null ? "disabled" : ""}>${app.t`inherited`}</button>
      <button class=-start_now>${app.t`scheduled`}</button>
      <input class=-start type=datetime-local value="${startVal}" style="width:auto" required>
    </div>
  </div>
  <div>
    <div style="flex:0 1 6.25rem">${app.t`until`}:</div>
    <div class=-accessTimeBtns>
      <button class=-end_always  ${node.vs.online_end === 0 ? "disabled" : ""}>${app.t`unlimited`}</button>
      <button class=-end_inherit ${node.vs.online_end === null ? "disabled" : ""}>${app.t`inherited`}</button>
      <button class=-end_now>${app.t`scheduled`}</button>
      <input class=-end type=datetime-local value="${endVal}" style="width:auto" required>
    </div>
  </div>
</div>
<style>
.access-time-manager > div { display:flex; flex-wrap:wrap; align-items:baseline; margin:0 -.4rem; }
.access-time-manager > div > div { margin:.2rem .4rem; }
.access-time-manager .-accessTimeBtns { display:inline-flex; white-space:nowrap; gap:1px; }
.access-time-manager .-accessTimeBtns > * { border-radius:0; margin:0 -.5px; }
</style>`;
}
