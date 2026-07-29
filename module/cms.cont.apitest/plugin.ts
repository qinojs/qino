import type { Node } from "../cms/mod.ts";
import { Access, hee, walk, type Ctx, type Route, type Verb } from "../core/mod.ts";

export const name = "cms.cont.apitest";
export const needs = ["cms"];

/** Static access category — the baseline badge; a dynamic guard may still differ per identity. */
function accessLabel(verb: Verb): string {
  if (!verb.access) return "none";
  if (verb.guard) return "dynamic";
  if (verb.access === Access.PUBLIC) return "public";
  if (verb.access === Access.SUPERUSER) return "superuser";
  if (verb.access === Access.USER) return "user";
  return "custom";
}

const paramNames = (r: Route): string[] =>
  r.segments.flatMap((seg, i) => seg.startsWith(":") && r.nodes[i] ? [seg.slice(1).replace(/\*$/, "")] : []);

function render(node: Node, { ctx }: { ctx: Ctx }): string {
  // smart prefill: current node feeds node-ish params, current user feeds user-ish ones
  const nid = String(node.id), uid = ctx.userId ? String(ctx.userId) : "";
  const prefill: Record<string, string> = { id: nid, pid: nid, node: nid, page: nid, lang: ctx.lang, user: uid, usr: uid, uid };

  let group = "";
  const rows = [...walk(ctx.app.aptTree)].map((r) => {
    const path = "/" + r.segments.join("/");
    const g = r.segments[0] ?? "";
    const groupRow = g !== group ? (group = g, `<tr class=-group data-group="${hee(g)}"><td colspan=2><button data-gtoggle>▾</button> ${hee(g)}</td></tr>`) : "";
    const params = paramNames(r).map((p) =>
      `<label class=-param>:${hee(p)}<input data-param="${hee(p)}" value="${hee(prefill[p])}"></label>`
    ).join("");
    return `${groupRow}
    <tr data-method="${hee(r.method)}" data-path="${hee(path)}" data-group="${hee(g)}">
      <td class=-route>
        <span class=-method>${hee(r.method.toUpperCase())}</span>
        <code>${hee(path)}</code>
        <span class="-access -a-${accessLabel(r.verb)}">${accessLabel(r.verb)}</span>
        <span class=-params>${params}</span>
        ${r.verb.description ? `<small class=-desc>${hee(r.verb.description)}</small>` : ""}
      </td>
      <td class=-cells></td>
    </tr>`;
  }).join("");

  return `<div class=-m-apitest data-app-url="${hee(ctx.req.basePath ?? "/")}">
  <div class=-bar>
    <span class=-identities></span>
    <form class=-add>
      <input data-label placeholder=label>
      <input data-token placeholder="qk_… bearer token">
      <button>+ identity</button>
    </form>
    <span class=-legend>✓ granted &nbsp; ✗ denied &nbsp; ⊘ csrf/origin gate &nbsp; … needs param</span>
    <input type=search class=-filter placeholder="filter…">
  </div>
  <table class=-matrix>
    <thead><tr>
      <th class=-route>route
      <th class=-cells>
    <tbody>${rows}</tbody>
  </table>
</div>`;
}

export const cms = {
  node: { css: ["pub/main.css"], js: ["pub/main.js"], render },
};
