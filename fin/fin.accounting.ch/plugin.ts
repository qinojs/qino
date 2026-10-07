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
  moneyBy: "cash:1000, saferpay:1091",
};

/**
 * The main accounts of the Swiss SME chart (Kontenrahmen KMU) and, where nothing is set yet,
 * the book's currency and the roles of automatic entries. Accounts are only added or renamed,
 * never removed: what was booked stays.
 */
export async function install({ app }: { app: App }): Promise<void> {
  for (const [number, name, type] of chart) await account(app, number, { name, type: type as AccountType });
  const s = app.settings["fin.accounting"];
  if (!await s.currency) await s.currency("CHF");
  for (const [role, number] of Object.entries(ROLES)) if (!await s.accounts[role]) await s.accounts[role](number);
}
