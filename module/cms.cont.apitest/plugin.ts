import type { Node } from "../cms/mod.ts";
import { Access, getCtx, hee, toJsonSchema, walk, type AptNode, type Route, type StandardSchema, type Verb } from "../core/mod.ts";
import { toInput } from "../../deps.ts";

export const name = "cms.cont.apitest";
export const needs = ["cms"];

type AccessLabel = "public" | "user" | "superuser" | "dynamic" | "custom" | "none";

/** Static access category of a verb — the baseline shown per route, before per-identity probing. */
function accessLabel(verb: Verb): AccessLabel {
  if (!verb.access) return "none";
  if (verb.guard) return "dynamic"; // decided per-call, so a probe can differ from the static label
  if (verb.access === Access.PUBLIC) return "public";
  if (verb.access === Access.SUPERUSER) return "superuser";
  if (verb.access === Access.USER) return "user";
  return "custom";
}

function pathParamsOf(r: Route): { name: string; jsonSchema: Record<string, unknown> }[] {
  return r.segments.flatMap((seg, i) => {
    if (!seg.startsWith(":")) return [];
    const schema = (r.nodes[i] as AptNode)?.paramSchema;
    return [{ name: seg.slice(1).replace(/\*$/, ""), jsonSchema: schema ? toJsonSchema(schema) : { type: "string" } }];
  });
}

/** One labelled input per object-schema field; reused for body and query in the run panel. */
function formFields(s: StandardSchema | undefined): string {
  if (!s || s.kind !== "object" || !s.shape) return "";
  return Object.entries(s.shape).map(([k, v]) => {
    const field = v as StandardSchema;
    const inner = field.kind === "optional" ? field.inner ?? field : field;
    const required = field.kind !== "optional" && !field.defaultValue;
    const description = field.description ?? inner.description;
    const input = toInput({ title: description, ...toJsonSchema(inner) }, { name: k, required });
    return `<label class="-field"><span>${hee(k)}${required ? "" : "?"}</span><span>${input}</span></label>`;
  }).join("");
}

function render(node: Node): string {
  const ctx = getCtx();
  const appURL = ctx.req.basePath ?? "/";

  // smart prefill: current node feeds node-ish params, current user feeds user-ish params
  const nid = String(node.id);
  const uid = ctx.userId ? String(ctx.userId) : "";
  const prefill: Record<string, string> = {
    id: nid, pid: nid, node: nid, page: nid,
    lang: ctx.lang,
    user: uid, usr: uid, uid, userId: uid,
  };

  const routes = [...walk(ctx.app.aptTree)];

  const meta = routes.map((r, idx) => {
    const params = pathParamsOf(r);
    return {
      idx,
      method: r.method,
      path: "/" + r.segments.join("/"),
      access: accessLabel(r.verb),
      description: r.verb.description ?? "",
      params: params.map((p) => ({ name: p.name, value: prefill[p.name] ?? "" })),
      hasInput: !!r.verb.input,
      hasQuery: !!r.verb.query,
    };
  });

  let group = "";
  const rows = meta.map((m) => {
    const g = m.path.split("/")[1] ?? "";
    const groupRow = g !== group ? (group = g, `<tr class="-group" data-group="${hee(g)}"><td colspan="2"><button type="button" data-gtoggle>▾</button> ${hee(g)}</td></tr>`) : "";
    const paramInputs = m.params.map((p) =>
      `<label class="-param">:${hee(p.name)}<input data-param="${hee(p.name)}" value="${hee(p.value)}" size="6"></label>`
    ).join("");
    const bodyForm = m.hasInput ? `<div class="-section" data-part="body"><b>body</b>${formFields(routes[m.idx].verb.input)}</div>` : "";
    const queryForm = m.hasQuery ? `<div class="-section" data-part="query"><b>query</b>${formFields(routes[m.idx].verb.query)}</div>` : "";
    return `${groupRow}
    <tr data-idx="${m.idx}" data-method="${hee(m.method)}" data-path="${hee(m.path)}" data-group="${hee(g)}">
      <td class="-route">
        <small class="u2-badge -method">${hee(m.method.toUpperCase())}</small>
        <code>${hee(m.path)}</code>
        <span class="-access -a-${m.access}" title="static access">${m.access}</span>
        <span class="-params">${paramInputs}</span>
        ${m.description ? `<small class="-desc">${hee(m.description)}</small>` : ""}
        <button type="button" data-toggle title="open / run">▸</button>
      </td>
      <td class="-cells"></td>
    </tr>
    <tr class="-detail" hidden><td colspan="2">
      <form class="-form">${bodyForm}${queryForm}
        <u2-buttongroup>
          <label>as <select data-as></select></label>
          <button type="submit">run (real call)</button>
        </u2-buttongroup>
      </form>
      <u2-code data-result></u2-code>
    </td></tr>`;
  }).join("");

  return `<div class="-m-apitest" data-app-url="${hee(appURL)}">
  <div class="-bar">
    <span class="-identities"></span>
    <form class="-add">
      <input data-label placeholder="label" size="10">
      <input data-token placeholder="qk_… bearer token" size="18">
      <button>add identity</button>
    </form>
    <button type="button" data-checkall>check all</button>
    <input type="search" class="-filter" placeholder="filter…">
  </div>
  <table class="-matrix">
    <thead><tr><th class="-route">route</th><th class="-cells"></th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
</div>`;
}

export const cms = {
  node: { css: ["pub/main.css"], js: ["pub/main.js"], render },
};
