import { getCtx, html, isEmptyObject } from "@qino/qino";
import * as u2 from "@qino/qino/u2";
import { channels, placeholderName, saveTemplate, templated, templates } from "@qino/qino/messaging";

import type { App, HtmlString, Row } from "@qino/qino";
import type { Computed, Placeholder } from "@qino/qino/messaging";
import type { Node } from "@qino/qino/cms";

const FORMATS = ["", "md", "html"];
/** Who the preview greets — a template says nothing about a real recipient. The ids make the
 *  unsubscribe link a real one: following it only ever asks, and dropping anyone needs a POST. */
export const SAMPLE = {
  given_name: "Ada",
  family_name: "Lovelace",
  organization: "Analytical Engines",
  email: "ada@example.test",
  address: "ada@example.test",
  usrId: 1,
  grpId: 1,
};

/** What the preview puts inside the template, in the template's own format. */
export async function sampleMsg(app: App, format?: "md" | "html"): Promise<{ text: string; format?: "md" | "html" }> {
  return { text: await app.t`This is where the message goes. It shows here as this channel would show it.`, format };
}

export function render(node: Node): Promise<HtmlString | string> {
  const query = getCtx().req.query;
  const name = String(query.name ?? "");
  const channel = String(query.channel ?? "");
  return name && channel ? detail(node, name, channel) : overview(node);
}

/** Every template that exists, and the form that writes the next. */
export async function overview(node: Node): Promise<HtmlString | string> {
  const app = node.app;
  const t = app.t;
  const ctx = getCtx();
  const post = ctx.req.body;

  if (post?.csrfToken === ctx.csrfToken && "create" in post) {
    const name = String(post.name ?? "").trim();
    const channel = String(post.channel ?? "");
    if (name && channel) {
      await saveTemplate(app, { name, channel, text: "{{content}}" });
      return redirect(`?name=${encodeURIComponent(name)}&channel=${encodeURIComponent(channel)}`);
    }
  }

  const rows = await templates(app);
  const url = ctx.req.url.toURL();
  const [none, main] = await Promise.all([t`No templates yet.`, t`Main`]);
  const body = rows.length ? rows.map((row) => {
    url.searchParams.set("name", String(row.name));
    url.searchParams.set("channel", String(row.channel));
    return html`<tr u2-href>
      <td><a href="${url.search}">${row.name}</a>
      <td>${row.channel}
      <td>${row.main ? "✓" : ""}
      <td>${row.format || "text"}
      <td><small>${firstLine(row.text)}</small>`;
  }) : html`<tr><td colspan=5>${none}`;

  return html.async`<div class=u2-flex>
  <div class=u2-card style="flex:1 1 40rem">
    <div class=-head>${t`Templates`}</div>
    <table class=u2-table>
      <thead><tr>
        <th>${t`Name`}
        <th>${t`Channel`}
        <th>${main}
        <th>${t`Format`}
        <th>
      <tbody>${body}
    </table>
  </div>
  <div class=u2-card style="flex:0 1 20rem">
    <div class=-head>${t`New template`}</div>
    <form method=post class=-body>
      <input type=hidden name=csrfToken value="${ctx.csrfToken}">
      <u2-fields>
        ${t`Name`} <input name=name required placeholder="newsletter">
        ${t`Channel`} <select name=channel>${channels(app).map((c) =>
          html`<option value="${c.name}">${c.label}</option>`)}</select>
      </u2-fields>
      <button name=create>${t`Create`}</button>
    </form>
  </div>
  ${placeholders(node, await sampleValues(app))}
</div>`;
}

/** One template: what it says, and what a message looks like inside it. */
async function detail(node: Node, name: string, channel: string): Promise<HtmlString | string> {
  const app = node.app;
  const t = app.t;
  const ctx = getCtx();
  const post = ctx.req.body;
  u2.elements(ctx, "code"); // the editor highlights with a library of its own
  const back = ctx.req.url.toURL();
  back.searchParams.delete("name");
  back.searchParams.delete("channel");

  if (post?.csrfToken === ctx.csrfToken) {
    if ("delete" in post) {
      await app.db.exec`DELETE FROM message_template WHERE name = ${name} AND channel = ${channel}`;
      return redirect(back.search || "?");
    }
    if ("save" in post) {
      await saveTemplate(app, {
        name,
        channel,
        main: "main" in post,
        format: String(post.format ?? "") || null,
        text: String(post.text ?? ""),
      });
    }
  }

  const row = await app.db.row`SELECT * FROM message_template WHERE name = ${name} AND channel = ${channel}`;
  if (!row) return html.async`<div class=u2-card><div class=-body>${t`Template not found.`}</div></div>`;
  // worked out once: the preview puts them in the template, the list beside it shows what they are
  const values = await sampleValues(app);

  return html.async`<div class=u2-flex style="flex-basis:100%">
  <div class=u2-card style="flex:1 1 45rem">
    <div class=-head>${row.name} <span class=u2-badge>${row.channel}</span></div>
    <form method=post>
      <input type=hidden name=csrfToken value="${ctx.csrfToken}">
      <u2-fields>
        ${t`Format`} <select name=format>${FORMATS.map((f) =>
          html`<option value="${f}"${f === (row.format ?? "") ? html.raw(" selected") : ""}>${f || "text"}</option>`)}</select>
        ${t`Main for this channel`} <input type=checkbox name=main${row.main ? html.raw(" checked") : ""}>
      </u2-fields>
      <u2-code class=-editor${row.format ? html.raw(` language=${row.format === "html" ? "html" : "markdown"}`) : ""}><textarea name=text>${row.text ?? ""}</textarea></u2-code>
      <div class=-actions>
        <button name=save>${t`Save`}</button>
        <button name=delete formnovalidate u2-confirm="${t`Really delete this template?`}">${t`Delete`}</button>
        <a href="${back.search || "?"}">${t`Back`}</a>
      </div>
    </form>
  </div>
  ${preview(node, row, values)}
  ${placeholders(node, values)}
</div>`;
}

/** The saved template around a sample message, in the forms this channel really sends: a text-only
 *  template has no markup to show, and only mail is worth running past the client simulator. */
async function preview(node: Node, row: Row, values: Computed): Promise<HtmlString> {
  const app = node.app;
  const t = app.t;
  const channel = String(row.channel);
  const format = (row.format || undefined) as "md" | "html" | undefined;
  const template = { text: String(row.text ?? ""), format };
  const render = templated(template, await sampleMsg(app, format), channel === "telegram" ? "telegram" : "html");
  const { text, html: markup } = render(values);
  const simulated = channel === "email";

  // the markup card stays in the document even with nothing to show: a format switch brings it back
  return html.async`<div class="u2-card -markup" style="flex:1 1 55rem"${markup ? "" : html.raw(" hidden")}>
    <div class=-head>${t`HTML`}
      ${simulated ? html.async`<label>${t`Mail client`} <select class=-client></select></label>` : ""}</div>
    <div class=-body>
      <iframe sandbox srcdoc="${markup ?? ""}" class=-frame></iframe>
      ${simulated ? html`<small class=-notes></small>` : ""}
    </div>
    ${simulated ? html`<div class=-report></div>` : ""}
  </div>
  <div class=u2-card style="flex:1 1 20rem">
    <div class=-head>${t`Text`}</div>
    <div class=-body><pre class=-text>${text}</pre></div>
  </div>`;
}

async function placeholders(node: Node, values: Computed): Promise<HtmlString> {
  const app = node.app;
  const t = app.t;
  const offered = new Map([...contributed(app)].map(([mod, made]) =>
    [mod, Object.keys(made).map((name) => placeholderName(mod, name)).sort()]));
  const rows = await templates(app);
  const missing = channels(app).filter((c) => !rows.some((row) => row.channel === c.name && row.main));
  const [copy, textLabel, htmlLabel] = await Promise.all([t`Click to copy`, t`Text`, t`HTML`]);

  /** What each one is worth for the sample recipient, in both forms a message goes out in. */
  const table = (names: string[] = []) =>
    html`<table class=-values>
      <tr>
        <th>{{…}}</th>
        <th>${textLabel}</th>
        <th>${htmlLabel}</th>
      </tr>
      ${names.map((name) => html`<tr>
        <td>${codes([name], copy)}</td>
        <td title="${values[name]?.text ?? ""}">${values[name]?.text ?? ""}</td>
        <td title="${values[name]?.html ?? ""}"><code>${values[name]?.html ?? ""}</code></td>
      </tr>`)}
    </table>`;

  return html.async`<div class=u2-card style="flex:1 1 32rem">
    <div class=-head>${t`Placeholders`}</div>
    <div class=-body>
      <p>${codes(["content"], copy)}— ${t`the message itself, already rendered`}</p>
      ${table(offered.get("messaging"))}
      <p>${t`A placeholder with no value for this recipient leaves an empty gap. Write {{givenName|Kunde}} to say what stands there instead.`}</p>
      ${[...offered].filter(([mod]) => mod !== "messaging").map(([mod, names]) =>
        html`<details><summary>${mod}</summary>${table(names)}</details>`)}
      <p>${t`A message that names no template gets its channel's main one. Where a channel has none, the message goes out unwrapped:`}
        ${missing.length ? missing.map((c) => html`<span class=u2-badge>${c.label}</span> `) : t`none`}</p>
    </div>
  </div>`;
}

const codes = (names: string[] = [], copy = "") =>
  names.map((name) => html`<code data-copy title="${copy}">{{${name}}}</code> `);

/** What the modules offer, each under the name of whoever offers it. */
function contributed(app: App): Map<string, Record<string, Placeholder>> {
  return new Map(app.modules.linked().flatMap((mod) => {
    const made = mod.plugin.messagingPlaceholders as Record<string, Placeholder> | undefined;
    return made && !isEmptyObject(made) ? [[mod.name, made] as const] : [];
  }));
}

/** Every placeholder worked out for the sample recipient — the preview asks the modules themselves,
 *  so an unset logo or a missing address shows here as it would in the mail. */
export async function sampleValues(app: App): Promise<Computed> {
  const made = [...contributed(app)].flatMap(([mod, made]) =>
    Object.entries(made).map(([name, make]) => [placeholderName(mod, name), make] as const));
  // a preview is not a send: one placeholder that cannot answer must not take the page down
  const values = await Promise.all(made.map(async ([name, make]) =>
    [name, await make(app, SAMPLE).catch(() => EMPTY) ?? EMPTY] as const
  ));
  return Object.fromEntries(values);
}

const EMPTY = { text: "", html: "" };

function redirect(to: string): string {
  const ctx = getCtx();
  ctx.res.status = 302;
  ctx.res.headers.set("Location", to);
  return "";
}

function firstLine(text: unknown): string {
  const line = String(text ?? "").trim().split("\n", 1)[0];
  return line.length > 60 ? line.slice(0, 60) + "…" : line;
}
