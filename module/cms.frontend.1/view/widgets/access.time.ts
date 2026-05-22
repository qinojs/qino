import type { Node } from "../../../cms/lib/Node.ts";

function toDatetimeLocal(ts: string | number | null): string {
  if (!ts) return "";
  const d = new Date(Number(ts) * 1000);
  return d.toISOString().slice(0, 16);
}

export default async function (node: Node): Promise<string> {
  const app = node.app;
  const startVal = toDatetimeLocal(node.vs.online_start);
  const endVal   = toDatetimeLocal(node.vs.online_end);

  return `<div class=qgCmsFront1AccessTimeManager pid=${node}>
  <div>
    <div style="flex:0 1 100px">${await app.t`visible`} ${await app.t`from`}:</div>
    <div class=-accessTimeBtns>
      <button class=-start_always  ${node.vs.online_start === 0 ? "disabled" : ""}>${await app.t`unlimited`}</button>
      <button class=-start_inherit ${node.vs.online_start === null ? "disabled" : ""}>${await app.t`inherited`}</button>
      <button class=-start_now>${await app.t`scheduled`}</button>
      <input class=-start type=datetime-local value="${startVal}" style="width:auto" required>
    </div>
  </div>
  <div>
    <div style="flex:0 1 100px">${await app.t`until`}:</div>
    <div class=-accessTimeBtns>
      <button class=-end_always  ${node.vs.online_end === 0 ? "disabled" : ""}>${await app.t`unlimited`}</button>
      <button class=-end_inherit ${node.vs.online_end === null ? "disabled" : ""}>${await app.t`inherited`}</button>
      <button class=-end_now>${await app.t`scheduled`}</button>
      <input class=-end type=datetime-local value="${endVal}" style="width:auto" required>
    </div>
  </div>
</div>
<style>
.qgCmsFront1AccessTimeManager > div { display:flex; flex-wrap:wrap; align-items:baseline; margin:0 -6px; }
.qgCmsFront1AccessTimeManager > div > div { margin:3px 6px; }
body .-accessTimeBtns { display:inline-flex; white-space:nowrap; }
body .-accessTimeBtns > * { border-radius:0; margin:0 -.5px; }
</style>`;
}
