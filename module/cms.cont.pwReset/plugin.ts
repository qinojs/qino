import type { Node } from "../cms/mod.ts";
import { html, pwHash, type App, type Ctx, type HtmlString } from "../core/mod.ts";
import { check, type Ticket, type TicketKind } from "../ticket/mod.ts";
import api, { PURPOSE, TICKET_PARAM, TTL } from "./nodeApi.ts";

export const name = "cms.cont.pwReset";
export const description = "Lets users who forgot their password set a new one through a link sent by mail.";
export const needs = ["cms", "mail", "ticket"];

export const tickets: Record<string, TicketKind> = {
  [PURPOSE]: {
    ttl: TTL,
    redeem: async (app: App, ticket: Ticket, input?: unknown) => {
      const { usrId } = ticket.data as { usrId: number };
      const pw = String((input as { pw: string }).pw);
      await app.db.table("usr").update(usrId, { pw: await pwHash(pw) });
      // whoever knew the old password is out — a reset is also how a takeover is undone
      await app.db.exec`DELETE FROM sess WHERE usr_id = ${usrId}`;
    },
  },
};

async function render(node: Node, { ctx }: { ctx: Ctx }): Promise<HtmlString> {
  const t = node.app.t;
  const handle = String(ctx.req.query[TICKET_PARAM] ?? "");
  // opening the link only looks — mail scanners must not spend the ticket
  const ticket = handle ? await check(node.app, handle) : undefined;
  if (handle && !ticket) {
    return html.async`<p>${t`This link is no longer valid. Please request a new one.`}</p>`;
  }
  if (ticket) {
    const iso = new Date(Number(ticket.expires) * 1000).toISOString();
    return html.async`<form data-reset>
    <input type=hidden name=handle value="${handle}">
    <u2-fields>
      ${t`New password`} <input type=password name=pw autocomplete=new-password minlength=8 required>
    </u2-fields>
    <button>${t`Set password`}</button>
    <p><small>${t`This link is valid until`}
      <u2-time datetime="${iso}" type=relative second>${iso.slice(0, 16).replace("T", " ")}</u2-time></small></p>
    <output class=-msg></output>
  </form>`;
  }
  return html.async`<form data-request>
    <u2-fields>
      ${t`E-Mail`} <input type=email name=email autocomplete=email required>
    </u2-fields>
    <button>${t`Send link`}</button>
    <output class=-msg></output>
  </form>`;
}

export const cms = { node: { js: ["pub/main.js"], render, api } };
