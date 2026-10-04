import { hee, Output, Redirect, safeEqual } from "@qino/qino";

import { accounts, authorize, exchange, hostId, models, pending, remove, revoke, select, store } from "./lib/account.ts";
import { ensureProvider } from "./lib/provider.ts";
import { chatgpt } from "./lib/response.ts";

import type { App, Ctx } from "@qino/qino";
import type { Pending } from "./lib/account.ts";

export const ai1Adapters = { "chatgpt-plan": chatgpt };

const base = (ctx: Ctx) => ctx.req.appUrl + "ai1-chatgpt";
const local = (ctx: Ctx) => ctx.req.url.protocol === "http:" && ctx.req.url.hostname === "127.0.0.1";
const returnTo = (ctx: Ctx, raw: unknown): string => {
  if (typeof raw !== "string" || !raw.startsWith(ctx.req.appUrl) || /[\\\x00-\x1f]/.test(raw)) return base(ctx);
  const url = new URL(raw, ctx.req.url.origin);
  return url.origin === ctx.req.url.origin && url.pathname.startsWith(ctx.req.appUrl) ? url.pathname + url.search : base(ctx);
};

function user(ctx: Ctx): number {
  if (!ctx.userId) throw new Output("Sign in to Qino first", { status: 401 });
  return ctx.userId;
}

function requireLocal(ctx: Ctx): void {
  if (!local(ctx)) throw new Output("ChatGPT plan sign-in requires Qino on http://127.0.0.1", { status: 403 });
}

async function page(ctx: Ctx): Promise<never> {
  const id = user(ctx), value = await accounts(ctx.app, id), root = base(ctx);
  const rows = value.accounts.map((a) => `<li>${hee(a.email || a.subject)} ${a.client_id === value.active ? "(active)" : ""}
    <a href="${root}/start?client_id=${encodeURIComponent(a.client_id)}">Reconnect</a>
    <form method="post" action="${root}/select"><input type="hidden" name="csrf" value="${ctx.csrfToken}"><input type="hidden" name="client_id" value="${hee(a.client_id)}"><button>Select</button></form>
    <form method="post" action="${root}/disconnect"><input type="hidden" name="csrf" value="${ctx.csrfToken}"><input type="hidden" name="client_id" value="${hee(a.client_id)}"><button>Disconnect</button></form></li>`).join("");
  const localUrl = new URL(ctx.req.url.href);
  localUrl.hostname = "127.0.0.1";
  const message = local(ctx) ? `<a href="${root}/start">Continue with ChatGPT</a>`
    : ctx.req.url.protocol === "http:" && ctx.req.url.hostname === "localhost"
    ? `<a href="${hee(localUrl.href)}">Open this page on 127.0.0.1 to connect ChatGPT</a>`
    : "Open this Qino installation at http://127.0.0.1 to connect a ChatGPT plan.";
  let catalog = "";
  if (value.active) {
    try { catalog = `<h2>Available model IDs</h2><ul>${(await models(ctx.app, id)).map((model) => `<li><code>${hee(model)}</code></li>`).join("")}</ul>`; }
    catch { catalog = "<p>Model catalog is temporarily unavailable.</p>"; }
  }
  throw new Output(`<!doctype html><html lang="en"><meta charset="utf-8"><title>ChatGPT plan for Qino</title><h1>ChatGPT plan for Qino</h1><p>${message}</p><ul>${rows}</ul>${catalog}`,
    { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}

async function start(ctx: Ctx): Promise<never> {
  const id = user(ctx); requireLocal(ctx);
  const value = await accounts(ctx.app, id);
  const hint = value.accounts.find((a) => a.client_id === ctx.req.query.client_id);
  if (ctx.req.query.client_id && !hint) throw new Output("Unknown ChatGPT account", { status: 404 });
  const redirectUri = ctx.req.url.origin + base(ctx) + "/callback";
  const attempt = pending(id, hint?.client_id ?? "dynamic_agent_client", redirectUri, returnTo(ctx, ctx.req.query.return_to));
  ctx.sess.data.ai1Chatgpt.pending(attempt);
  throw new Redirect(await authorize(attempt, await hostId(ctx.app), "Qino", hint));
}

async function callback(ctx: Ctx): Promise<never> {
  const id = user(ctx); requireLocal(ctx);
  const attempt = ctx.sess.data.ai1Chatgpt.pending() as Pending | undefined;
  ctx.sess.data.ai1Chatgpt.pending(null);
  if (!attempt || attempt.user !== id || Date.now() - attempt.time > 10 * 60_000 || !safeEqual(ctx.req.query.state, attempt.state) ||
    ctx.req.url.origin + base(ctx) + "/callback" !== attempt.redirect_uri)
    throw new Output("ChatGPT sign-in state mismatch", { status: 400 });
  if (ctx.req.query.error) throw new Redirect(base(ctx) + "?error=declined");
  const code = ctx.req.query.code;
  if (!code) throw new Output("ChatGPT did not return a code", { status: 400 });
  const previous = (await accounts(ctx.app, id)).accounts.find((a) => a.client_id === attempt.client_id);
  const account = await exchange(attempt, code, ctx.req.query.client_id, previous);
  await store(ctx.app, id, account);
  await models(ctx.app, id);
  throw new Redirect(returnTo(ctx, attempt.return_to));
}

async function update(ctx: Ctx, action: "select" | "disconnect"): Promise<never> {
  const id = user(ctx);
  if (!safeEqual(ctx.req.body?.csrf, ctx.csrfToken)) throw new Output("Invalid form token", { status: 403 });
  const clientId = String(ctx.req.body?.client_id ?? "");
  const value = await accounts(ctx.app, id), account = value.accounts.find((a) => a.client_id === clientId);
  if (!account) throw new Output("Unknown ChatGPT account", { status: 404 });
  if (action === "select") { await select(ctx.app, id, clientId); await models(ctx.app, id); }
  else { await revoke(account); await remove(ctx.app, id, clientId); }
  throw new Redirect(returnTo(ctx, ctx.req.body?.return_to), 303);
}

export async function init(app: App, { signal }: { signal: AbortSignal }): Promise<void> {
  await ensureProvider(app);
  const routes: Record<string, (ctx: Ctx) => Promise<never>> = {
    "GET ai1-chatgpt": page, "GET ai1-chatgpt/start": start, "GET ai1-chatgpt/callback": callback,
    "POST ai1-chatgpt/select": (ctx) => update(ctx, "select"),
    "POST ai1-chatgpt/disconnect": (ctx) => update(ctx, "disconnect"),
  };
  app.on("route", ({ ctx }) => routes[`${ctx.req.method} ${ctx.req.appPath}`]?.(ctx), { signal });
}
