import { getCtx, html, sql } from "@qino/qino";
import * as u2 from "@qino/qino/u2";

import type { Ctx, HtmlString } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

export const cms = { node: { js: ["pub/main.js"], render, api } };

/** Sign the user out on another device: sessions, remembered login, link. */
export async function api(node: Node, vars: Record<string, unknown>): Promise<Record<string, unknown> | null> {
  const ctx = getCtx();
  const t = node.app.t;
  const id = Number(vars.logout_client ?? 0);
  if (!ctx.userId || !id) return null;
  if (String(id) === ctx.clientId) return { ok: false, message: await t`Use the logout button of this device.` };

  const db = ctx.app.db;
  const link = await db.table("client_usr").get({ client_id: String(id), usr_id: String(ctx.userId) });
  if (!link) return { ok: false, message: await t`Unknown device.` };

  // the log is the only link between a device and its sessions; usr_id keeps it to my own
  const sessIds = await db.col<number>`SELECT DISTINCT sess_id FROM log WHERE client_id = ${id} AND sess_id IS NOT NULL`;
  if (sessIds.length) await db.exec`DELETE FROM sess WHERE usr_id = ${ctx.userId} AND ${sql.in("id", sessIds)}`;
  await link.$remove();
  const client = await db.table("client").get(id);
  // only if that device is signed in as *me* — someone else may be using it right now
  if (client && Number(client.$get("usr_id")) === ctx.userId) await client.$set({ usr_id: 0 });
  return { ok: true };
}

// Longest-match first: every user agent claims to be the ones below it.
const BROWSERS: Record<string, RegExp> = {
  Claude: /Claude/i,
  Edge: /Edg\//,
  Opera: /OPR\/|Opera/,
  "Samsung Internet": /SamsungBrowser/,
  Firefox: /Firefox\/|FxiOS/,
  Chrome: /Chrome\/|Chromium|CriOS/,
  Safari: /Safari\//,
  Bot: /bot|crawler|spider|curl|wget/i,
};

const SYSTEMS: Record<string, RegExp> = {
  Windows: /Windows/,
  Android: /Android/,
  iOS: /iPhone|iPad|iPod/,
  macOS: /Mac OS X|Macintosh/,
  ChromeOS: /CrOS/,
  Linux: /Linux/,
};

const label = (list: Record<string, RegExp>, ua: string) => Object.keys(list).find((name) => list[name].test(ua)) ?? "";

/** "Firefox · Windows", as much of it as the user agent gives away. */
const device = (ua: string) => [label(BROWSERS, ua), label(SYSTEMS, ua)].filter(Boolean).join(" · ") || ua.slice(0, 40);

/** Reverse-DNS name of an IP, in-addr.arpa for v4, ip6.arpa for v6. */
function arpaName(ip: string): string {
  if (!ip.includes(":")) return ip.split(".").reverse().join(".") + ".in-addr.arpa";
  const [head, tail = ""] = ip.split("::");
  const groups = head ? head.split(":") : [], rest = tail ? tail.split(":") : [];
  const full = [...groups, ...Array(8 - groups.length - rest.length).fill("0"), ...rest];
  return [...full.map((g) => g.padStart(4, "0")).join("")].reverse().join(".") + ".ip6.arpa";
}

/** Host names for the IPs, "" if none. Best effort, with short timeout. */
async function ipHosts(ips: string[]): Promise<Record<string, string>> {
  return Object.fromEntries(await Promise.all([...new Set(ips.filter(Boolean))].map(async (ip) => [
    ip,
    await Deno.resolveDns(arpaName(ip), "PTR", { signal: AbortSignal.timeout(1000) })
      .then((names) => names[0]?.replace(/\.$/, "") ?? "").catch(() => ""),
  ])));
}

const ACTIVE = 15 * 60; // seconds since the last request that still count as "here"

async function render(node: Node, { ctx }: { ctx: Ctx }): Promise<HtmlString> {
  const t = node.app.t;
  if (!ctx.user) return html.async`<p>${t`Please sign in.`}</p>`;

  // client_usr records "this user signed in on this device".
  const links = await node.app.db.query`SELECT client_id, save_login, time AS since FROM client_usr WHERE usr_id = ${ctx.userId}`;
  if (!links.length) return html.async`<div><h3>${t`Your devices`}</h3><p>${t`No devices found.`}</p></div>`;

  // The newest log row per device (last seen, user agent). An IN list instead of a correlated
  // subquery, so it stays an index lookup.
  const rows = await node.app.db.query`
    SELECT l.client_id, l.time, ua.user_agent, ip.ip
    FROM log l
    LEFT JOIN log_user_agent ua ON ua.id = l.user_agent_id
    LEFT JOIN log_ip ip ON ip.id = l.ip_id
    WHERE l.id IN (SELECT MAX(id) FROM log WHERE ${sql.in("client_id", links.map((link) => link.client_id))} GROUP BY client_id)
  `;
  const seen = new Map(rows.map((row) => [Number(row.client_id), row]));
  const lastSeen = (link: typeof links[number]) => Number(seen.get(Number(link.client_id))?.time ?? 0);
  links.sort((a, b) => lastSeen(b) - lastSeen(a) || Number(b.since) - Number(a.since));

  const hosts = await ipHosts(rows.map((row) => String(row.ip ?? "")));
  const now = Date.now() / 1000;

  const items = links.map((link) => {
    const last = seen.get(Number(link.client_id));
    const ua = String(last?.user_agent ?? "");
    const ip = String(last?.ip ?? "");
    const self = String(link.client_id) === ctx.clientId;
    const state = self ? html.async`<strong>${t`This device`}</strong>` : now - lastSeen(link) <= ACTIVE ? t`Active` : t`Inactive`;

    return html.async`<tr>
      <td title="${ua}">${device(ua) || t`Unknown device`}
      <td>${!ip ? "–" : ip === ctx.req.clientIp ? html`<strong>${ip}</strong>` : ip}
        ${hosts[ip] ? html`<br><small>${hosts[ip]}</small>` : ""}
      <td>${u2.el.time(link.since)}
      <td>${u2.el.time(lastSeen(link))}
      <td>${link.save_login ? t`Yes` : "–"}
      <td>${state}
      <td><button type=button data-logout="${link.client_id}"${self ? html.raw(" data-self") : ""}>${t`Log out`}</button>
    `;
  });

  return html.async`<div>
    <h3>${t`Your devices`}</h3>
    <table class=u2-table>
      <thead><tr>
        <th>${t`Device`}
        <th>${t`IP`}
        <th>${t`Since`}
        <th>${t`Last seen`}
        <th>${t`Stay signed in`}
        <th>${t`State`}
        <th>
      <tbody>${items}
    </table>
  </div>`;
}
