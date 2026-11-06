import { addContact, ApiError, contactKey, contactOwner, html, sql, unixTime } from "@qino/qino";
import { cms as cmsOf } from "@qino/qino/cms";
import { send } from "@qino/qino/messaging.email";
import { issue, redeem } from "@qino/qino/ticket";

import type { App, Ctx } from "@qino/qino";
import type { Node } from "@qino/qino/cms";
import type { TicketKind } from "@qino/qino/ticket";

const PURPOSE = "cms.cont.newsletter.confirm";
const PARAM = "cms_newsletter_token";
const TTL = 24 * 60 * 60;
const PER_HOUR = 3;

const nodeSettingsSchema = {
  properties: {
    grp_id: { type: "integer", minimum: 1, description: "Group of type newsletter; empty: the only one there is." },
  },
};

/** The node's newsletter group: its grp_id if that is a newsletter, else the only newsletter there is. */
async function group(node: Node): Promise<number | undefined> {
  const id = Number(node.settings.grp_id());
  const ids = await node.app.db.col`SELECT id FROM grp WHERE type = ${"newsletter"} ${id ? sql`AND id = ${id}` : sql``} LIMIT 2`;
  return ids.length === 1 ? Number(ids[0]) : undefined;
}

const mailReady = async (app: App) => !!String(await app.settings["messaging.email"].address ?? "").trim();

export const tickets: Record<string, TicketKind> = {
  [PURPOSE]: {
    ttl: TTL,
    redeem: async (app, ticket) => {
      const { address, grpId, nodeId } = ticket.data as { address: string; grpId: number; nodeId: number };
      const node = await cmsOf(app).node(nodeId);
      if (!node.exists() || node.vs.module !== "cms.cont.newsletter" || await group(node) !== grpId)
        throw new ApiError(404, "Newsletter subscription unavailable");
      await app.db.transaction(async () => {
        let usrId = await contactOwner(app.db, "email", address);
        if (!usrId) {
          usrId = Number(await app.db.table("usr").insert({ active: false, pw: "" }));
          await addContact(app.db, usrId, "email", address);
        }
        await app.db.table("usr_grp").ensure({ usr_id: usrId, grp_id: grpId });
      });
    },
  },
};

async function request(node: Node, address: string, grpId: number) {
  const app = node.app;
  const data = JSON.stringify({ address, grpId, nodeId: node.id });
  const sent = Number(await app.db.one`SELECT COUNT(*) FROM ticket
    WHERE purpose = ${PURPOSE} AND data = ${data} AND created > ${unixTime() - 3600}`);
  if (sent >= PER_HOUR) return;
  const handle = await issue(app, PURPOSE, { address, grpId, nodeId: node.id });
  const url = new URL(await node.url(), await app.url());
  url.searchParams.set(PARAM, handle);
  await send(app, { email: address }, {
    title: await app.t`Confirm your newsletter subscription`,
    text: await app.t`Open this link and confirm your newsletter subscription: ${url.href}

The link is valid for 24 hours. If you did not request this, ignore this email.`,
  });
}

async function renderContent(node: Node, { ctx, vars }: { ctx: Ctx; vars: Record<string, unknown> }) {
  const app = node.app, t = app.t, edit = await node.edit();
  const heading = edit || (await node.showTitle()).plain() ? node.cms.text(node, "title", { tag: "h2" }) : "";
  const box = (body: unknown) => html.async`<div class=u2-width>${heading}${body}</div>`;
  const handle = ctx.req.query[PARAM] ?? "";

  if (vars.confirm && handle && String(vars.confirm) === handle) {
    const ok = await redeem(app, handle, PURPOSE)
      .then(() => true, (e) => e instanceof ApiError ? false : Promise.reject(e));
    return box(html.async`<p>${ok ? t`Your newsletter subscription is confirmed.` : t`This link is no longer valid.`}</p>`);
  }
  if (handle) return box(html.async`<form method=post>
    ${node.cms.formFields(node)}
    <button name=confirm value="${handle}">${t`Confirm newsletter subscription`}</button>
  </form>`);

  const grpId = await mailReady(app) ? await group(node) : undefined;
  if (!grpId) return box(html.async`<p>${edit
    ? t`Configure a newsletter group and email delivery.`
    : t`Newsletter signup is currently unavailable.`}</p>`);

  if (vars.subscribe) {
    const input = String(vars.email ?? "");
    let address = "";
    try {
      address = contactKey("email", input);
      if (address.length > 254) address = "";
    } catch { /* use the same response for invalid addresses */ }
    app.fire("suspicious", { ctx, weight: 1, reason: "newsletter signup requested" }).catch(() => {});
    if (address && !vars.your_name) {
      app.languages.with({ ns: "cms.cont.newsletter", lang: ctx.lang }, () => request(node, address, grpId))
        .catch((e) => console.error(`[newsletter ${node.id}]`, e));
    }
    return box(html.async`<p>${t`If this address can be subscribed, a confirmation link is on its way.`}</p>`);
  }

  return box(html.async`<form method=post>
    ${node.cms.formFields(node)}
    <input type=text name=your_name autocomplete=off tabindex=-1 aria-hidden=true>
    <label>${t`Email address`} <input type=email name=email autocomplete=email maxlength=254 required></label>
    <button name=subscribe value=1>${t`Subscribe to newsletter`}</button>
  </form>`);
}

function render(node: Node, args: { ctx: Ctx; vars: Record<string, unknown> }) {
  return node.app.languages.with({ ns: "cms.cont.newsletter" }, () => renderContent(node, args));
}

export const cms = { node: { render, settingsSchema: nodeSettingsSchema, css: ["pub/main.css"] } };
