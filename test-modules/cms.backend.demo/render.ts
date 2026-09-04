import { html } from "@qino/qino";
import { cms } from "@qino/qino/cms";

import * as ledger from "./lib/ledger.ts";
import { seeders } from "./lib/seeders.ts";
import { PW } from "./lib/seeders/users.ts";

import type { HtmlString } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

export function render(node: Node): Promise<HtmlString> {
  const t = node.app.t;
  const missing = (needs: string[] = []) => needs.filter((table) => !node.app.db.tables[table]);

  return html.async`<div class="u2-card">
    <div class=-head>
      <span>${t`Demo data`}</span>
      <select name=scale title="${t`How much of everything`}">
        <option value=1>${t`normal`}
        <option value=0.3>${t`small`}
        <option value=3>${t`large`}
        <option value=10>${t`huge`}
      </select>
      <button type=button data-fill>${t`Fill in demo data`}</button>
      <button type=button data-wipe u2-confirm="${t`Remove everything the last run created?`}">${t`Remove`}</button>
    </div>
    <div>
      <p>${t`Fills the installation with pages, users, groups, mail, visits and more — enough to see how the backend behaves with real amounts of data. Only what a run created is written; a new run removes the previous data first and leaves everything else untouched.`}
      <p><small>${t`A test fixture. Demo accounts are real accounts with a known password — never seed a production site.`}</small>
      <table class=u2-table>
        <thead><tr>
          <th>
          <th>${t`Seeder`}
          <th>${t`Creates`}
        <tbody>${seeders.map((seeder) => {
          const gone = missing(seeder.needs);
          return html.async`<tr>
            <td><input type=checkbox name=seeder value="${seeder.name}" checked ${gone.length ? html.raw("disabled") : ""}>
            <td><label><code>${seeder.name}</code></label>
            <td>${seeder.title}${gone.length ? html.async` <small class=u2-badge>${t`needs`} ${gone.join(", ")}</small>` : ""}`;
        })}
      </table>
    </div>
    <div cms-part=status>${status(node)}</div>
  </div>`;
}

export async function status(node: Node): Promise<HtmlString> {
  const t = node.app.t;
  const last = await ledger.read(node.app);
  if (!last.rows.length) return html.async`<div class=-body><p>${t`No demo data in this installation.`}</div>`;

  // No request context when the ledger is read from a script — then the site link is simply left out.
  const root = last.root ? (await cms(node.app).node(last.root)).exists() : undefined;
  const url = root ? await root.url().catch(() => "") : "";
  const link = root && url ? html`<a href="${url}">${await (await root.title()).string()}</a>` : html``;

  return html.async`<div class=-body>
    <p>${t`Seeded`} <u2-time datetime="${new Date(last.time * 1000).toISOString()}" type=relative></u2-time>
      — <b>${last.rows.length}</b> ${t`rows in the ledger`}. ${link}
    <p>${Object.entries(last.counts).map(([kind, n]) => html`<small class=u2-badge>${n} ${kind}</small> `)}
    <p><small>${t`Log in as any demo user with the password`} <code>${PW}</code>.</small>
  </div>`;
}
