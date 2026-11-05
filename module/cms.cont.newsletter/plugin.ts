import { addContact, ApiError, contactKey, contactOwner, html, unixTime } from "@qino/qino";
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

export const settingsSchema = {
  properties: {
    allowed_groups: {
      type: "string",
      description: "Comma-separated grp IDs eligible for newsletter signup. Empty disables signup.",
    },
  },
};

const nodeSettingsSchema = {
  properties: {
    grp_id: { type: "integer", minimum: 1, description: "Newsletter grp ID; must also be allowed by the app and have type newsletter." },
    group_label: { type: "string", description: "Exact name of the selected newsletter group, to catch accidental ID changes." },
  },
};

async function allowed(app: App, grpId: number) {
  if (!Number.isSafeInteger(grpId) || grpId < 1) return false;
  const ids = String(await app.settings["cms.cont.newsletter"].allowed_groups ?? "")
    .split(",").map((id) => Number(id.trim()));
  return ids.includes(grpId);
}

async function eligible(node: Node, grpId: number) {
  const name = String(node.settings.group_label() ?? "").trim();
  return !!name && await allowed(node.app, grpId) && !!await node.app.db.one`
    SELECT id FROM grp WHERE id = ${grpId} AND type = ${"newsletter"} AND name = ${name}`;
}

const mailReady = async (app: App) => !!String(await app.settings["messaging.email"].address ?? "").trim();

export const tickets: Record<string, TicketKind> = {
  [PURPOSE]: {
    ttl: TTL,
    redeem: async (app, ticket) => {
      const { address, grpId, nodeId } = ticket.data as { address: string; grpId: number; nodeId: number };
      const node = await cmsOf(app).node(nodeId);
      if (!node.exists() || node.vs.module !== "cms.cont.newsletter" || Number(node.settings.grp_id()) !== grpId)
        throw new ApiError(404, "Newsletter subscription unavailable");
      await app.db.transaction(async () => {
        if (!await eligible(node, grpId)) throw new ApiError(404, "Newsletter subscription unavailable");
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

async function request(node: Node, address: string) {
  const app = node.app;
  const grpId = Number(node.settings.grp_id());
  if (!await mailReady(app) || !await eligible(node, grpId)) return;
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
  const t = node.app.t;
  const heading = (await node.showTitle()).plain() || "Newsletter";
  const handle = String(ctx.req.query[PARAM] ?? "");
  const grpId = Number(node.settings.grp_id());
  const enabled = await eligible(node, grpId) && await mailReady(node.app);

  if (vars.confirm && handle && String(vars.confirm) === handle) {
    const ok = await redeem(node.app, handle, PURPOSE)
      .then(() => true, (e) => e instanceof ApiError ? false : Promise.reject(e));
    return html.async`<div class=u2-width><h2>${heading}</h2><p>${ok
      ? t`Your newsletter subscription is confirmed.`
      : t`This link is no longer valid.`}</p></div>`;
  }
  if (handle) return html.async`<div class=u2-width><h2>${heading}</h2><form method=post>
    ${node.cms.formFields(node)}
    <button name=confirm value="${handle}">${t`Confirm newsletter subscription`}</button>
  </form></div>`;

  if (!enabled) return html.async`<div class=u2-width><h2>${heading}</h2><p>${await node.edit()
    ? t`Configure a newsletter group and email delivery.`
    : t`Newsletter signup is currently unavailable.`}</p></div>`;

  if (vars.subscribe) {
    const input = String(vars.email ?? "");
    let address = "";
    try {
      address = contactKey("email", input);
      if (address.length > 254) address = "";
    } catch { /* use the same response for invalid addresses */ }
    node.app.fire("suspicious", { ctx, weight: 1, reason: "newsletter signup requested" }).catch(() => {});
    if (address && !vars.your_name) {
      node.app.languages.with({ ns: "cms.cont.newsletter", lang: ctx.lang }, () => request(node, address))
        .catch((e) => console.error(`[newsletter ${node.id}]`, e));
    }
    return html.async`<div class=u2-width><h2>${heading}</h2><p>${t`If this address can be subscribed, a confirmation link is on its way.`}</p></div>`;
  }

  return html.async`<div class=u2-width><h2>${heading}</h2><form method=post>
    ${node.cms.formFields(node)}
    <input type=text name=your_name autocomplete=off tabindex=-1 aria-hidden=true>
    <label>${t`Email address`} <input type=email name=email autocomplete=email maxlength=254 required></label>
    <button name=subscribe value=1>${t`Subscribe to newsletter`}</button>
  </form></div>`;
}

function render(node: Node, args: { ctx: Ctx; vars: Record<string, unknown> }) {
  return node.app.languages.with({ ns: "cms.cont.newsletter" }, () => renderContent(node, args));
}

export const cms = { node: { render, settingsSchema: nodeSettingsSchema, css: ["pub/main.css"] } };
