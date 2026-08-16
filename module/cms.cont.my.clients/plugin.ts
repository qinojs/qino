import { getCtx, html } from "@qino/qino";

import type { Ctx, HtmlString } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

export const cms = { node: { js: ["pub/main.js"], render, api } };

export async function api(node: Node, vars: Record<string, unknown>): Promise<Record<string, unknown> | null> {
  const ctx = getCtx();
  const id = Number(vars.logout_client ?? 0);
  if (!id) return null;
  if (String(id) === String(ctx.clientId)) return { ok: false, message: "Use the logout button on this device." };

  const client = await ctx.app.db.row`SELECT id, usr_id FROM client WHERE id = ${id}`;
  if (!client || Number(client.usr_id) !== Number(ctx.userId)) return { ok: false, message: "Client not found." };

  const sessIds = await ctx.app.db.query`SELECT DISTINCT sess_id FROM log WHERE client_id = ${id} AND sess_id IS NOT NULL`;
  const ids = sessIds.map((row) => Number(row.sess_id)).filter((value) => value && value !== Number(ctx.sess?.id));
  if (ids.length) await ctx.app.db.exec`DELETE FROM sess WHERE usr_id = ${ctx.userId} AND id IN (${ids})`;
  await ctx.app.db.table("client_usr").delete({ client_id: id, usr_id: String(ctx.userId) });
  await ctx.app.db.table("client").update(id, { usr_id: 0 });
  return { ok: true };
}

function shortUa(ua = ""): string {
  const text = ua.trim();
  if (!text) return "Unknown device";
  if (/Claude Desktop/i.test(text)) return "Claude Desktop";
  if (/Firefox/i.test(text)) return "Firefox";
  if (/Chrome|Chromium/i.test(text)) return "Chrome";
  if (/Safari/i.test(text)) return "Safari";
  if (/Android/i.test(text)) return "Android";
  if (/iPhone|iPad/i.test(text)) return "iPhone / iPad";
  if (/Windows/i.test(text)) return "Windows";
  if (/Mac OS X|Macintosh/i.test(text)) return "Mac";
  if (/Linux/i.test(text)) return "Linux";
  return text.slice(0, 40) || "Unknown device";
}

function osLabel(ua = ""): string {
  const text = ua.trim();
  if (!text) return "";
  if (/Windows/i.test(text)) return "Windows";
  if (/Android/i.test(text)) return "Android";
  if (/iPhone|iPad/i.test(text)) return "iOS";
  if (/Mac OS X|Macintosh/i.test(text)) return "macOS";
  if (/Linux/i.test(text)) return "Linux";
  if (/CrOS/i.test(text)) return "ChromeOS";
  return "";
}

function isoTime(ts: number | null | undefined): string {
  if (!ts) return "";
  const d = new Date(Number(ts) * 1000);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString();
}

function active(lastSeen: number | null | undefined): boolean {
  if (!lastSeen) return false;
  return Date.now() / 1000 - Number(lastSeen) <= 60 * 15;
}

async function render(node: Node, { ctx }: { ctx: Ctx }): Promise<HtmlString> {
  const t = node.app.t;
  if (!ctx.user) return html.async`<p>${t`Please sign in.`}</p>`;

  const db = node.app.db;
  if (!db) {
    return html.async`<div>
      <h3>${t`Active clients`}</h3>
      <table class=u2-table>
        <thead><tr>
          <th>${t`Device`}<th>${t`Location`}<th>${t`First seen`}<th>${t`Last seen`}<th>${t`State`}
        <tbody>
          <tr><td>–<td>–<td>–<td>–<td>${t`Current`}
      </table>
    </div>`;
  }

  const rows = await db.query`
    SELECT
      c.id AS client_id,
      c.hash,
      MIN(log.time) AS first_seen,
      MAX(log.time) AS last_seen,
      ua.user_agent,
      ip.ip
    FROM client c
    LEFT JOIN log ON log.client_id = c.id
    LEFT JOIN log_user_agent ua ON ua.id = log.user_agent_id
    LEFT JOIN log_ip ip ON ip.id = log.ip_id
    WHERE c.id IN (
      SELECT client_id FROM client_usr WHERE usr_id = ${ctx.userId}
    ) OR c.usr_id = ${ctx.userId}
    GROUP BY c.id, c.hash, ua.user_agent, ip.ip
    ORDER BY MAX(log.time) DESC, c.id DESC
  `;

  if (!rows.length) return html.async`<div><h3>${t`Active clients`}</h3><p>${t`No devices found.`}</p></div>`;

  const items = rows.map((row) => {
    const ua = String(row.user_agent ?? "");
    const device = osLabel(ua) ? `${shortUa(ua)} (${osLabel(ua)})` : shortUa(ua);
    const lastSeen = Number(row.last_seen ?? 0) || 0;
    const firstSeen = Number(row.first_seen ?? 0) || 0;
    const location = row.ip ? String(row.ip) : "–";
    const state = active(lastSeen) ? "Current" : "Inactive";

    return html.async`<tr>
      <td>${device}
      <td>${location}
      <td>${firstSeen ? html`<u2-time datetime="${isoTime(firstSeen)}" type=relative></u2-time>` : "–"}
      <td>${lastSeen ? html`<u2-time datetime="${isoTime(lastSeen)}" type=relative></u2-time>` : "–"}
      <td>${state}
      <td><button type=button data-client="${row.client_id}" data-logout>${t`Log out`}</button>
    `;
  });

  return html.async`<div>
    <h3>${t`Active clients`}</h3>
    <table class=u2-table>
      <thead><tr>
        <th>${t`Device`}<th>${t`Location`}<th>${t`First seen`}<th>${t`Last seen`}<th>${t`State`}<th>
      <tbody>${items}
    </table>
  </div>`;
}
