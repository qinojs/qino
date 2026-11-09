import { App, hee, s } from "@qino/qino";
import { listen, shopT } from "@qino/qino/cms.shop";
import { send } from "@qino/qino/messaging.email";

import type { EventDecls } from "@qino/qino";
import type { Attachment } from "@qino/qino/messaging";
import type { Order, Party } from "@qino/qino/cms.shop";

export const settingsSchema = {
  properties: {
    toCustomer: { type: "boolean", default: true, description: "The customer gets a confirmation." },
    receivers: { type: "string", description: "Who gets a copy of every order, comma separated." },
  },
};

Object.assign(App.events, {
  "shop:mail": {
    description: "An order confirmation is about to go out; add attachments. copy: the shop's own copy.",
    data: s.object({ order: s.any(), copy: s.boolean(), attachments: s.array(s.any()) }),
  },
} satisfies EventDecls);

const party = (p?: Party) => p ? [p.name, p.address?.streetAddress, [p.address?.postalCode, p.address?.addressLocality].filter(Boolean).join(" "), p.address?.addressCountry, p.email, p.telephone].filter(Boolean).map(hee).join("<br>") : "";

/** The order as mail html — inline, mail clients know no stylesheets. */
async function body(app: App, order: Order): Promise<string> {
  const t = shopT(app), currency = await order.currencyRow();
  const money = (v: number) => hee(currency?.show(v) ?? v);
  const rows = [];
  for (const l of await order.lines()) {
    rows.push(`<tr><td>${Number(l.quantity)}<td>${hee(l.name)}${l.description ? `<br><small>${hee(l.description).replaceAll("\n", "<br>")}</small>` : ""}<td align=right>${money(l.total())}`);
  }
  for (const x of await order.extras()) rows.push(`<tr><td><td>${hee(x.name)}<td align=right>${money(x.price)}`);
  const { tax, total } = await order.totals();
  return `<p>${hee(await t`Thank you for your order`)} ${hee(order.$id)}.</p>
<table cellpadding=4>${rows.join("")}
<tr><td><td>${hee(await t`VAT`)}<td align=right>${money(tax)}
<tr><td><td><b>${hee(await t`Total`)}</b><td align=right><b>${money(total)}</b>
</table>
<p><b>${hee(await t`Billing address`)}</b><br>${party(order.party("bill"))}</p>
${order.ship ? `<p><b>${hee(await t`Delivery address`)}</b><br>${party(order.party("ship"))}</p>` : ""}`;
}

/** Confirmation and copy; the order stands either way, a mail that fails is only logged. */
async function mail(app: App, order: Order): Promise<void> {
  const settings = app.settings["cms.shop.mail"];
  const t = shopT(app), title = `${await t`Your order no.`} ${order.$id}`;
  const text = await body(app, order);
  const email = order.party("bill")?.email;
  if (email && await settings.toCustomer !== false) {
    const e = { order, copy: false, attachments: [] as Attachment[] };
    await app.fire("shop:mail", e);
    await send(app, { email }, { title, format: "html", text, attachments: e.attachments });
  }
  const receivers = String(await settings.receivers ?? "").split(/[\s,;]+/).filter(Boolean);
  if (!receivers.length) return;
  const e = { order, copy: true, attachments: [] as Attachment[] };
  await app.fire("shop:mail", e);
  await send(app, { email: receivers }, { title: `${title} (${await t`copy`})`, format: "html", text, attachments: e.attachments });
}

export function init(app: App, { signal }: { signal: AbortSignal }): void {
  listen(app, signal)("shop:ordered", ({ order }: { order: Order }) =>
    mail(app, order).catch((e) => console.error(`cms.shop.mail: order ${order.$id}:`, e)));
}
