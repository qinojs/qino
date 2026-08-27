import { html, unixTime } from "@qino/qino";
import { backend } from "@qino/qino/cms.backend";
import * as u2 from "@qino/qino/u2";

import { contacts, inbound, journal, render, send, sending } from "./render.ts";
import api from "./nodeApi.ts";
import manifest from "./manifest.json" with { type: "json" };

import type { App, HtmlString } from "@qino/qino";

const { name } = manifest;

export async function install({ app }: { app: App }): Promise<void> {
  await backend.install(app, name, { en: "Email", de: "E-Mail" });
}

const RECENT = 7;

export async function backendDashboardWidget(app: App): Promise<HtmlString> {
  const week = unixTime() - RECENT * 86400;
  const [totals, traffic, recent, labels] = await Promise.all([
    app.db.row`SELECT COUNT(*) AS n,
        SUM(CASE WHEN error IS NULL THEN 0 ELSE 1 END) AS failing
      FROM usr_contact WHERE type = ${"email"}`.catch(() => undefined),
    app.db.row`SELECT
        SUM(CASE WHEN direction = ${"out"} THEN 1 ELSE 0 END) AS outgoing,
        SUM(CASE WHEN direction = ${"in"} THEN 1 ELSE 0 END) AS incoming
      FROM message WHERE channel = ${"email"} AND time >= ${week}`.catch(() => undefined),
    app.db.query`SELECT m.id, m.direction, m.title, m.time FROM message m
      WHERE m.channel = ${"email"} ORDER BY m.time DESC, m.id DESC LIMIT 5`.catch(() => []),
    Promise.all([app.t`addresses`, app.t`sent`, app.t`received`, app.t`failing`]),
  ]);
  const [addressesLabel, sentLabel, receivedLabel, failingLabel] = labels;
  const failing = Number(totals?.failing ?? 0);

  return html.async`<div class=-body>
    <b>${Number(totals?.n ?? 0)}</b> ${addressesLabel}
    · ${Number(traffic?.outgoing ?? 0)} ${sentLabel}
    · ${Number(traffic?.incoming ?? 0)} ${receivedLabel}
    ${failing ? html` · <span class=u2-badge>${failing} ${failingLabel}</span>` : ""}
    ${recent.length ? html`<table class=u2-table>${recent.map((m) => html`<tr>
      <td>${m.direction === "out" ? "→" : "←"}
      <td>${m.title}
      <td>${u2.el.time(m.time)}`)}</table>` : ""}
  </div>`;
}

export const cms = {
  node: {
    js: ["pub/main.js"],
    render,
    api,
    parts: { sending, inbound, send, contacts, journal },
  },
};
