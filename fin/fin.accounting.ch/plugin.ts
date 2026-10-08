import { mainCurrency } from "@qino/qino/fin";
import { account } from "@qino/qino/fin.accounting";

import chart from "./chart.json" with { type: "json" };

import type { App } from "@qino/qino";
import type { AccountType } from "@qino/qino/fin.accounting";

/** Where automatic entries go, in the chart below. */
const ROLES = {
  receivable: "1100",
  payable: "2000",
  revenue: "3400",
  expense: "4400",
  vatDue: "2200",
  vatInput: "1170",
  fees: "6940",
  money: "1020",
  moneyBy: "cash:1000, saferpay:1091, credit:2030",
  result: "2979",
};

export const settingsSchema = {
  properties: {
    vat: {
      description: "The VAT return",
      properties: {
        method: {
          type: "string",
          enum: ["effective", "saldo"],
          default: "effective",
          description: "VAT method: effective (tax less input tax) or saldo (net tax rate on turnover)",
        },
        rate: { type: "number", description: "Net tax rate in percent, for the saldo method" },
      },
    },
  },
};

/**
 * The main accounts of the Swiss SME chart (Kontenrahmen KMU) and, where nothing is set yet,
 * the roles of automatic entries — and CHF as main currency, where none follows from the
 * organization. Accounts are only added or renamed, never removed: what was booked stays.
 */
export async function install({ app }: { app: App }): Promise<void> {
  for (const [number, name, type] of chart) await account(app, number, { name, type: type as AccountType });
  if (!await mainCurrency(app)) await app.settings.fin.mainCurrency("CHF");
  const s = app.settings["fin.accounting"];
  for (const [role, number] of Object.entries(ROLES)) if (!await s.accounts[role]) await s.accounts[role](number);
}
