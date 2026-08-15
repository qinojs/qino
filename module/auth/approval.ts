import { ApiError, randB64, sha256b64url, unixTime } from "@qino/qino";
import { channels as messagingChannels } from "@qino/qino/messaging";

import type { App, Ctx, Row } from "@qino/qino";

type ApprovalNeed = {
  action: string;
  summary: string;
  details?: unknown;
  requester?: string;
};

type Approval = {
  id: string;
  usrId: number;
  action: string;
  summary: string;
  details: unknown;
  requester: string;
  channel: string;
  status: string;
  requested: number;
  expires: number;
  decided?: number;
  consumed?: number;
};

const DEFAULT_TTL = 10 * 60;
const DEFAULT_PENDING_LIMIT = 10;
const DEFAULT_CHANNELS = "web_push,email,sms";
const MAX_DETAILS = 16 * 1024;

/** Hash binding an approval to the exact action and JSON-safe details. */
function approvalIntent(action: string, details?: unknown): Promise<string> {
  return sha256b64url(stableJson({ action, details: details ?? null }));
}

/** Create and notify one approval owned by the request's user. */
async function requestApproval(ctx: Ctx, need: ApprovalNeed): Promise<Approval & { url: string }> {
  const { app, userId } = ctx;
  if (!userId) throw new ApiError(401, "Authentication required");
  const db = app.db;
  const settings = await approvalSettings(app);
  const action = field(need.action, "action", 127);
  const summary = field(need.summary, "summary", 255);
  const requester = field(need.requester ?? "api", "requester", 127);
  const details = stableJson(need.details ?? null);
  if (details.length > MAX_DETAILS) throw new ApiError(422, "Approval details are too large");

  await sweep(app);
  const pending = Number(await db.one`SELECT COUNT(*) FROM auth_approval WHERE usr_id = ${userId} AND status = ${"pending"}`);
  if (pending >= settings.pendingLimit) throw new ApiError(429, "Too many pending approvals");

  const now = unixTime();
  const id = randB64(24);
  await db.table("auth_approval").insert({
    id,
    usr_id: userId,
    action,
    intent: await approvalIntent(action, need.details),
    summary,
    details,
    requester,
    channel: "",
    status: "pending",
    requested: now,
    expires: now + settings.ttl,
    decided: null,
    consumed: null,
    log_id: await ctx.logId,
  });

  const url = approvalUrl(ctx, id);
  const channel = await notify(ctx, { action, summary, requester, url }, settings.channels);
  if (channel) await db.table("auth_approval").update(id, { channel });
  return { ...(await approval(app, userId, id))!, url };
}

/** Read one approval without spending it. */
export async function approval(app: App, usrId: number, id: string): Promise<Approval | undefined> {
  await expire(app, id);
  const row = await app.db.row`SELECT * FROM auth_approval WHERE id = ${id} AND usr_id = ${usrId}`;
  return row ? approvalOf(row) : undefined;
}

/** Recent approvals for trusted administration. */
export async function approvals(app: App, limit = 100): Promise<(Approval & { email?: string; firstname?: string; lastname?: string })[]> {
  await sweep(app);
  const rows = await app.db.query`SELECT a.*, u.email, u.firstname, u.lastname FROM auth_approval a
    LEFT JOIN usr u ON u.id = a.usr_id ORDER BY a.requested DESC LIMIT ${limit}`;
  return rows.map((row) => ({ ...approvalOf(row), email: row.email, firstname: row.firstname, lastname: row.lastname }));
}

/** Counts used by the administrative overview. */
export async function approvalStats(app: App): Promise<Record<string, number>> {
  await sweep(app);
  const rows = await app.db.query`SELECT status, COUNT(*) AS count FROM auth_approval GROUP BY status`;
  return Object.fromEntries(rows.map((row) => [String(row.status), Number(row.count)]));
}

/** Approve or deny one pending request. The caller must enforce interactive cookie authentication. */
export async function decideApproval(app: App, usrId: number, id: string, decision: "approved" | "denied"): Promise<Approval | undefined> {
  const now = unixTime();
  await app.db.exec`UPDATE auth_approval SET status = ${decision}, decided = ${now}
    WHERE id = ${id} AND usr_id = ${usrId} AND status = ${"pending"} AND expires >= ${now}`;
  return approval(app, usrId, id);
}

/** Atomically consume an approved request once, bound to user, action and exact details. */
async function consumeApproval(app: App, usrId: number, id: string, action: string, details?: unknown): Promise<boolean> {
  const now = unixTime();
  const used = await app.db.exec`UPDATE auth_approval SET status = ${"consumed"}, consumed = ${now}
    WHERE id = ${id} AND usr_id = ${usrId} AND action = ${action}
      AND intent = ${await approvalIntent(action, details)} AND status = ${"approved"} AND expires >= ${now}`;
  return !!used.affectedRows;
}

/**
 * Require an approval inside a sensitive endpoint. The endpoint passes the optional `authApproval`
 * input back on retry; changed action details cannot consume the grant.
 */
export async function requireApproval(ctx: Ctx, authApproval: unknown, need: ApprovalNeed): Promise<void> {
  const id = String(authApproval ?? "");
  if (id && await consumeApproval(ctx.app, ctx.userId, id, need.action, need.details)) return;
  if (id) {
    const known = await approval(ctx.app, ctx.userId, id);
    if (!known) throw new ApiError(404, "Approval not found");
    if (known.status === "pending") throw approvalRequired(known.id, approvalUrl(ctx, id));
    if (known.status === "approved") throw new ApiError(409, "Approval does not match this action");
    throw new ApiError(409, `Approval is ${known.status}`);
  }
  const created = await requestApproval(ctx, need);
  throw approvalRequired(created.id, created.url);
}

function approvalRequired(id: string, url: string): ApiError {
  return new ApiError(428, `Approval required [${id}]. Ask the user to open ${url}, then retry with authApproval="${id}".`);
}

function approvalUrl(ctx: Ctx, id: string): string {
  return new URL(ctx.req.appUrl + "auth/approval/" + encodeURIComponent(id), ctx.req.url.origin).href;
}

async function notify(
  ctx: Ctx,
  approval: { action: string; summary: string; requester: string; url: string },
  configured: string[],
): Promise<string> {
  const { app, userId } = ctx;
  const available = new Map(messagingChannels(app).map((channel) => [channel.name, channel]));
  const message = {
    title: await app.t`Action requires approval`,
    text: `${approval.summary}\n${approval.requester}: ${approval.action}\n${approval.url}`,
    url: approval.url,
    tag: "auth-approval",
    requireInteraction: true,
  };
  for (const name of configured) {
    const channel = available.get(name);
    if (!channel || !await channel.reach(app, userId).catch(() => 0)) continue;
    try {
      if (await channel.send(app, { usr: userId }, message)) return name;
    } catch (e) {
      console.warn(`auth: approval notification via ${name} failed`, e);
    }
  }
  return "";
}

async function approvalSettings(app: App) {
  const set = app.settings.auth.approval;
  const ttl = Math.min(60 * 60, Math.max(60, Number(await set.ttl) || DEFAULT_TTL));
  const pendingLimit = Math.min(100, Math.max(1, Number(await set.pendingLimit) || DEFAULT_PENDING_LIMIT));
  const channels = String(await set.channels ?? DEFAULT_CHANNELS).split(",").map((name) => name.trim()).filter(Boolean);
  return { ttl, pendingLimit, channels };
}

async function expire(app: App, id: string): Promise<void> {
  await app.db.exec`UPDATE auth_approval SET status = ${"expired"}
    WHERE id = ${id} AND status IN (${"pending"}, ${"approved"}) AND expires < ${unixTime()}`;
}

async function sweep(app: App): Promise<void> {
  const now = unixTime();
  await app.db.exec`UPDATE auth_approval SET status = ${"expired"}
    WHERE status IN (${"pending"}, ${"approved"}) AND expires < ${now}`;
  await app.db.exec`DELETE FROM auth_approval WHERE requested < ${now - 90 * 24 * 60 * 60}`;
}

function approvalOf(row: Row): Approval {
  return {
    id: String(row.id),
    usrId: Number(row.usr_id),
    action: String(row.action),
    summary: String(row.summary),
    details: JSON.parse(String(row.details)),
    requester: String(row.requester),
    channel: String(row.channel ?? ""),
    status: String(row.status),
    requested: Number(row.requested),
    expires: Number(row.expires),
    decided: row.decided == null ? undefined : Number(row.decided),
    consumed: row.consumed == null ? undefined : Number(row.consumed),
  };
}

function field(value: unknown, name: string, max: number): string {
  const text = String(value ?? "").trim();
  if (!text || text.length > max) throw new ApiError(422, `Invalid approval ${name}`);
  return text;
}

function stableJson(value: unknown): string {
  return JSON.stringify(sortValue(value)) ?? "null";
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortValue((value as Record<string, unknown>)[key])]));
}
