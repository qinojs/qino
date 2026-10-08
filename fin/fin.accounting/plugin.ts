import { onInvoice, onPayment } from "./lib/auto.ts";

import type { App } from "@qino/qino";

export { default as dbSchema } from "./dbschema.json" with { type: "json" };

const role = (description: string) => ({ type: "string", description });

export const settingsSchema = {
  properties: {
    currency: { type: "string", description: "The book's currency, ISO 4217; nothing is booked without it" },
    closedUntil: { type: "string", format: "date", description: "Entries up to this date are refused: closed" },
    accounts: {
      description: "Account numbers automatic entries use; a role left empty books nothing that needs it",
      properties: {
        receivable: role("What customers owe (issued invoices)"),
        payable: role("What we owe (received invoices)"),
        revenue: role("Income from issued invoices, net"),
        expense: role("Cost of received invoices, net"),
        vatDue: role("Tax charged on issued invoices"),
        vatInput: role("Tax paid on received invoices"),
        fees: role("What payment providers and banks keep"),
        money: role("Where money lands, unless moneyBy names the provider"),
        moneyBy: role("Per provider: bank:1020, cash:1000, saferpay:1091"),
        result: role("Where closing a year puts its profit or loss (equity)"),
      },
    },
  },
};

export function init(app: App, { signal }: { signal: AbortSignal }): void {
  // automatic entries follow the invoices and payments; a failure is logged, never in their way
  const log = (what: string) => (e: unknown) => console.error(`fin.accounting: ${what} not booked`, e);
  // deno-lint-ignore no-explicit-any -- module events carry their own payloads
  app.on("invoice:status", ({ invoice, previous }: any) =>
    onInvoice(app, invoice, previous).catch(log(`invoice ${invoice?.id}`)), { signal });
  // deno-lint-ignore no-explicit-any
  app.on("payment:change", ({ payment }: any) =>
    onPayment(app, payment).catch(log(`payment ${payment?.id}`)), { signal });
}
