import { Access, html, walk, type Ctx, type HtmlString, type Route, type Verb } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

export const name = "cms.cont.apitest";
export const description = "Api route access matrix for users and API keys.";
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

function render(node: Node, { ctx }: { ctx: Ctx }): HtmlString {
  // smart prefill: current node feeds node-ish params, current user feeds user-ish ones
  const nid = String(node.id), uid = ctx.userId ? String(ctx.userId) : "";
  const prefill: Record<string, string> = { id: nid, pid: nid, node: nid, page: nid, lang: ctx.lang, user: uid, usr: uid, uid };

  let group = "";
  const rows = [...walk(ctx.app.apiTree)].map((r) => {
    const path = "/" + r.segments.join("/");
    const g = r.segments[0] ?? "";
    const groupRow = g !== group ? (group = g, html`<tr class=-group data-group="${g}"><td colspan=2><button data-gtoggle>▾</button> ${g}</td></tr>`) : "";
    const params = html.join(paramNames(r).map((p) =>
      html`<label class=-param>:${p}<input data-param="${p}" value="${prefill[p]}"></label>`
    ));
    return html`${groupRow}
    <tr data-method="${r.method}" data-path="${path}" data-group="${g}">
      <td class=-route>
        <span class=-method>${r.method.toUpperCase()}</span>
        <code>${path}</code>
        <span class="-access -a-${accessLabel(r.verb)}">${accessLabel(r.verb)}</span>
        <span class=-params>${params}</span>
        ${r.verb.description ? html`<small class=-desc>${r.verb.description}</small>` : ""}
      </td>
      <td class=-cells></td>
    </tr>`;
  });

  return html`<div data-app-url="${ctx.req.appUrl ?? "/"}">
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
    <tbody>${html.join(rows)}</tbody>
  </table>
</div>`;
}

export const cms = {
  node: { css: ["pub/main.css"], js: ["pub/main.js"], render },
};
