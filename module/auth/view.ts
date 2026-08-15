import { html, Output, safeEqual } from "@qino/qino";

import { approval, decideApproval } from "./approval.ts";

import type { Ctx, HtmlString } from "@qino/qino";

export async function approvalPage(ctx: Ctx, id: string): Promise<never> {
  if (!ctx.user || ctx.statelessAuth) return notice(ctx, ctx.app.t`Sign in in this browser to continue.`, 403);
  if (!/^[A-Za-z0-9_-]{32}$/.test(id)) return notice(ctx, ctx.app.t`Request not found.`, 404);

  let row = await approval(ctx.app, ctx.userId, id);
  if (!row) return notice(ctx, ctx.app.t`Request not found.`, 404);

  const body = ctx.req.method === "POST" ? ctx.req.body : null;
  if (body?.decision != null) {
    if (!safeEqual(body.csrfToken, ctx.csrfToken)) return notice(ctx, ctx.app.t`Invalid form token.`, 403);
    const decision = body.decision === "approved" ? "approved" : body.decision === "denied" ? "denied" : null;
    if (decision) row = await decideApproval(ctx.app, ctx.userId, id, decision) ?? row;
  }

  const title = await ctx.app.t`Approve action`;
  const details = JSON.stringify(row.details, null, 2);
  const pending = row.status === "pending";
  return page(ctx, title, await html.async`<main>
    <h1>${title}</h1>
    <dl>
      <dt>${ctx.app.t`Action`}</dt><dd><code>${row.action}</code></dd>
      <dt>${ctx.app.t`Requested by`}</dt><dd>${row.requester}</dd>
      <dt>${ctx.app.t`Description`}</dt><dd>${row.summary}</dd>
      <dt>${ctx.app.t`Status`}</dt><dd>${row.status}</dd>
    </dl>
    ${details && details !== "null" ? html`<details><summary>${await ctx.app.t`Details`}</summary><pre>${details}</pre></details>` : ""}
    ${pending ? html.async`<form method=post>
      <input type=hidden name=csrfToken value="${ctx.csrfToken}">
      <button name=decision value=approved autofocus>${ctx.app.t`Approve`}</button>
      <button name=decision value=denied>${ctx.app.t`Deny`}</button>
    </form>` : html.async`<p>${ctx.app.t`This request is ${row.status}. You can close this page.`}</p>`}
  </main>`);
}

async function notice(ctx: Ctx, text: Promise<string>, status: number): Promise<never> {
  const title = await ctx.app.t`Approval`;
  return page(ctx, title, html`<main><h1>${title}</h1><p>${await text}</p></main>`, status);
}

function page(ctx: Ctx, title: string, body: HtmlString, status = 200): never {
  ctx.res.html.title = title;
  ctx.res.html.content = body.html;
  ctx.res.status = status;
  throw new Output();
}
