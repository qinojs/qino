import { DomUtils, parseDocument } from "htmlparser2";
import { ingest as store } from "@qino/qino/fin.bank";
import { currency as currencies } from "@qino/qino/locale.currency";

import type { App } from "@qino/qino";
import type { Statement, Tx } from "@qino/qino/fin.bank";

type El = ReturnType<typeof parseDocument>["children"][number] & { name?: string; attribs?: Record<string, string> };

/** Read camt.053 (statement) or camt.054 (notification) and store its lines. */
export async function ingest(app: App, xml: string): Promise<{ added: number; matched: number }> {
  let added = 0, matched = 0;
  for (const statement of parse(xml)) {
    const result = await store(app, statement);
    added += result.added;
    matched += result.matched;
  }
  return { added, matched };
}

/**
 * The statements in a camt.053 or camt.054 document, one per account. A batch entry is split into
 * its transactions, each with its own amount and reference — that is where the QR references of
 * a collective booking are.
 */
export function parse(xml: string): Statement[] {
  const doc = parseDocument(xml, { xmlMode: true });
  const reports = all(doc.children as El[], "Stmt").concat(all(doc.children as El[], "Ntfctn"));
  if (!reports.length) throw new Error("fin.bank.camt: neither a camt.053 statement nor a camt.054 notification");
  return reports.map((report) => {
    const currency = text(report, "Acct", "Ccy");
    const iban = text(report, "Acct", "Id", "IBAN") || text(report, "Acct", "Id", "Othr", "Id");
    const id = text(report, "Id");
    const transactions = kids(report, "Ntry").flatMap((entry, i) => lines(entry, currency, `${id}:${i}`));
    return { iban, currency, transactions };
  });
}

/** An entry's transactions; one without details is a line of its own. */
function lines(entry: El, currency: string, fallbackId: string): Tx[] {
  const date = (text(entry, "BookgDt", "Dt") || text(entry, "BookgDt", "DtTm")).slice(0, 10);
  const sign = text(entry, "CdtDbtInd") === "DBIT" ? -1 : 1;
  const entryId = text(entry, "AcctSvcrRef") || fallbackId;
  const details = kids(entry, "NtryDtls").flatMap((d) => kids(d, "TxDtls"));
  const entryText = text(entry, "AddtlNtryInf");
  if (!details.length) {
    const { value, currency: ccy } = amountOf(child(entry, "Amt"), currency);
    return [{ id: entryId, date, amount: sign * value, currency: ccy, text: entryText || undefined }];
  }
  return details.map((tx, i) => {
    const txSign = text(tx, "CdtDbtInd") ? (text(tx, "CdtDbtInd") === "DBIT" ? -1 : 1) : sign;
    const txAmount = child(tx, "Amt") ?? child(child(child(tx, "AmtDtls"), "TxAmt"), "Amt") ?? child(entry, "Amt");
    const amount = amountOf(txAmount, currency);
    const endToEnd = text(tx, "Refs", "EndToEndId");
    // the other side: who paid us, or whom we paid
    const party = txSign > 0 ? "Dbtr" : "Cdtr";
    const parties = child(tx, "RltdPties");
    return {
      id: text(tx, "Refs", "AcctSvcrRef") || `${entryId}:${i}`,
      date,
      amount: txSign * amount.value,
      currency: amount.currency,
      reference: text(tx, "RmtInf", "Strd", "CdtrRefInf", "Ref")
        || (endToEnd !== "NOTPROVIDED" && endToEnd) || undefined,
      partyName: text(parties, party, "Nm") || text(parties, party, "Pty", "Nm") || undefined,
      partyAccount: text(parties, `${party}Acct`, "Id", "IBAN") || undefined,
      text: [kids(child(tx, "RmtInf"), "Ustrd").map(content).join(" "), text(tx, "AddtlTxInf"), entryText]
        .filter(Boolean).join("\n") || undefined,
    };
  });
}

/** `472.26` in CHF → 47226: as many minor units as the currency has. */
function amountOf(el: El | undefined, fallback: string) {
  const currency = el?.attribs?.Ccy ?? fallback;
  const digits = currencies.decimals(currency);
  const [whole, fraction = ""] = content(el).trim().split(".");
  return { value: Number(whole + fraction.padEnd(digits, "0").slice(0, digits)), currency };
}

// Elements are matched by local name: some banks prefix the camt namespace.
const local = (el: El) => String(el.name ?? "").replace(/^.*:/, "");
const kids = (el: El | undefined, name: string) =>
  ((el as { children?: El[] })?.children ?? []).filter((c) => c.type === "tag" && local(c) === name);
const child = (el: El | undefined, name: string): El | undefined => kids(el, name)[0];
const all = (nodes: El[], name: string) => DomUtils.findAll((el) => local(el as El) === name, nodes) as El[];
const content = (el: El | undefined) => el ? DomUtils.textContent(el) : "";
/** The text at a path of child elements, trimmed; empty if any step is missing. */
const text = (el: El | undefined, ...path: string[]) => content(path.reduce((at, name) => child(at, name), el)).trim();
