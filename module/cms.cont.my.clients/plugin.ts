import { getCtx, html, sql } from "@qino/qino";

import type { Ctx, HtmlString } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

export const cms = { node: { js: ["pub/main.js"], render, api } };

/** Sign this user out on one of their other devices: its sessions, the remembered login, the link. */
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
  if (sessIds.length) {
    await db.exec`DELETE FROM sess WHERE usr_id = ${ctx.userId} AND id IN (${sql.join(sessIds.map((sessId) => sql`${sessId}`))})`;
  }
  await link.$remove();
  const client = await db.table("client").get(id);
  // only if that device is signed in as *me* — someone else may be using it right now
  if (client && Number(client.$get("usr_id")) === ctx.userId) await client.$set({ usr_id: 0 });
  return { ok: true };
}

// Longest-match first: every user agent claims to be the ones below it.
const BROWSERS: [RegExp, string][] = [
  [/Claude/i, "Claude"],
  [/Edg\//, "Edge"],
  [/OPR\/|Opera/, "Opera"],
  [/SamsungBrowser/, "Samsung Internet"],
  [/Firefox\/|FxiOS/, "Firefox"],
  [/Chrome\/|Chromium|CriOS/, "Chrome"],
  [/Safari\//, "Safari"],
  [/bot|crawler|spider|curl|wget/i, "Bot"],
];

const SYSTEMS: [RegExp, string][] = [
  [/Windows/, "Windows"],
  [/Android/, "Android"],
  [/iPhone|iPad|iPod/, "iOS"],
  [/Mac OS X|Macintosh/, "macOS"],
  [/CrOS/, "ChromeOS"],
  [/Linux/, "Linux"],
];

const label = (list: [RegExp, string][], ua: string) => list.find(([re]) => re.test(ua))?.[1] ?? "";

/** "Firefox · Windows", as much of it as the user agent gives away. */
function device(ua: string): string {
  const parts = [label(BROWSERS, ua), label(SYSTEMS, ua)].filter(Boolean);
  return parts.join(" · ") || ua.slice(0, 40);
}

/** Reverse-DNS name of an IP, in-addr.arpa for v4, ip6.arpa for v6. */
function arpaName(ip: string): string {
  if (!ip.includes(":")) return ip.split(".").reverse().join(".") + ".in-addr.arpa";
  const [head, tail = ""] = ip.split("::");
  const groups = head ? head.split(":") : [], rest = tail ? tail.split(":") : [];
  const full = [...groups, ...Array(8 - groups.length - rest.length).fill("0"), ...rest];
  return [...full.map((g) => g.padStart(4, "0")).join("")].reverse().join(".") + ".ip6.arpa";
}

/** Host names for the given IPs, "" where there is none. Best effort — never blocks the page for long. */
async function ipHosts(ips: string[]): Promise<Record<string, string>> {
  const list = [...new Set(ips.filter(Boolean))];
  const hosts = await Promise.all(list.map((ip) =>
    Deno.resolveDns(arpaName(ip), "PTR", { signal: AbortSignal.timeout(1000) })
      .then((names) => names[0]?.replace(/\.$/, "") ?? "").catch(() => "")
  ));
  return Object.fromEntries(list.map((ip, i) => [ip, hosts[i]]));
}

const ACTIVE = 15 * 60; // seconds since the last request that still count as "here"

function time(ts: number): HtmlString | string {
  if (!ts) return "–";
  const iso = new Date(ts * 1000).toISOString();
  return html`<u2-time datetime="${iso}" type=relative>${iso.slice(0, 16).replace("T", " ")}</u2-time>`;
}

async function render(node: Node, { ctx }: { ctx: Ctx }): Promise<HtmlString> {
  const t = node.app.t;
  if (!ctx.user) return html.async`<p>${t`Please sign in.`}</p>`;

  // client_usr records "this user signed in on this device"; the newest log row of that device
  // carries what it looked like and when it was last here.
  const rows = await node.app.db.query`
    SELECT c.id, cu.save_login, cu.time AS since, log.time AS last_seen, ua.user_agent, ip.ip
    FROM client_usr cu
    JOIN client c ON c.id = cu.client_id
    LEFT JOIN log ON log.id = (SELECT MAX(id) FROM log WHERE client_id = c.id)
    LEFT JOIN log_user_agent ua ON ua.id = log.user_agent_id
    LEFT JOIN log_ip ip ON ip.id = log.ip_id
    WHERE cu.usr_id = ${ctx.userId}
    ORDER BY last_seen DESC, cu.time DESC
  `;
  if (!rows.length) return html.async`<div><h3>${t`Your devices`}</h3><p>${t`No devices found.`}</p></div>`;

  const hosts = await ipHosts(rows.map((row) => String(row.ip ?? "")));
  const now = Date.now() / 1000;

  const items = rows.map((row) => {
    const ua = String(row.user_agent ?? "");
    const ip = String(row.ip ?? "");
    const lastSeen = Number(row.last_seen ?? 0);
    const self = String(row.id) === ctx.clientId;
    const state = self ? html.async`<strong>${t`This device`}</strong>` : now - lastSeen <= ACTIVE ? t`Active` : t`Inactive`;

    return html.async`<tr>
      <td title="${ua}">${device(ua) || t`Unknown device`}
      <td>${!ip ? "–" : ip === ctx.req.clientIp ? html`<strong>${ip}</strong>` : ip}
        ${hosts[ip] ? html`<br><small>${hosts[ip]}</small>` : ""}
      <td>${time(Number(row.since ?? 0))}
      <td>${time(lastSeen)}
      <td>${row.save_login ? t`Yes` : "–"}
      <td>${state}
      <td><button type=button data-logout="${row.id}"${self ? html.raw(" data-self") : ""}>${t`Log out`}</button>
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
