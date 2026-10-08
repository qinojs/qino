import { getCtx, html } from "@qino/qino";
import { backend } from "@qino/qino/cms.backend";
import { currency as currencies } from "@qino/qino/locale.currency";

import type { App, DbFile, HtmlString } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

/** Minor units as the request's language writes the currency: `CHF 472.26`, `JPY 1,000`. */
export function money(amount: unknown, currency: unknown): string {
  const code = String(currency || "CHF");
  const lang = (() => {
    try {
      return getCtx().lang;
    } catch {
      return "en";
    }
  })();
  const format = new Intl.NumberFormat(lang, { style: "currency", currency: code });
  return format.format(Number(amount) / 10 ** currencies.decimals(code));
}

const nowrap = (text: string) => html`<span style="white-space:nowrap">${text}</span>`;

/** What a person types (`120.50`, `120,50`) as minor units of the currency. */
export function toMinor(value: unknown, currency: string): number {
  const typed = Number(String(value ?? "").replace(/['\s]/g, "").replace(",", "."));
  const amount = Math.round(typed * 10 ** currencies.decimals(currency));
  if (!Number.isSafeInteger(amount)) throw new Error(`Not an amount: ${value}`);
  return amount;
}

/** A file as the fin pages send it (see `files` in pub/panel.js), stored as dbFile. */
export async function fileOf(app: App, sent: { name: string; type: string; data: string }): Promise<DbFile> {
  const bytes = Uint8Array.fromBase64(String(sent.data));
  return await app.dbFiles.add(new File([bytes], String(sent.name || "file"), { type: String(sent.type || "") }));
}

/** Amounts per currency: `CHF 120.00 · EUR 30.00`, or a dash for none. */
export const amounts = (rows: Record<string, unknown>[], key = "amount"): HtmlString | string =>
  rows.length
    ? html.join(rows.map((row) => nowrap(money(row[key], row.currency))), " · ")
    : "—";

/** A status's color, the same on every fin page; the quiet ones (draft, canceled …) have none. */
const STATUS: Record<string, string> = {
  open: "--blue",
  pending: "--yellow",
  processing: "--orange",
  paid: "--green",
  failed: "--red",
  refunded: "--blue",
};

/** A small badge, in a color of the palette (`--red`) where it should stand out. */
export const badge = (content: unknown, color = ""): Promise<HtmlString> =>
  html.async`<small class=u2-badge${color ? html.raw(` style="background:var(${color})"`) : ""}>${content}</small>`;

/** A status as a badge in its color. */
export const status = (value: unknown): Promise<HtmlString> => badge(value, STATUS[String(value)]);

/** Money in or out as an arrow; `label` says it in words, as title (a t`` may be passed). */
export const direction = (value: unknown, label: unknown): Promise<HtmlString> => value === "in"
  ? html.async`<u2-ico icon=call_received title="${label}">↙</u2-ico>`
  : html.async`<u2-ico icon=call_made title="${label}">↗</u2-ico>`;

/** The texts of the fin pages come from the namespace fin (fin/locale): run `fn` there. */
export const finTexts = <T>(app: App, fn: () => T): T => app.languages.with({ ns: "fin" }, fn);

/** A page function — render, api — with the texts of the namespace fin. */
export const inFin = <A extends unknown[], R>(fn: (node: Node, ...args: A) => R) =>
  (node: Node, ...args: A): R => finTexts(node.app, () => fn(node, ...args));

/** Whether a module is linked — the overview shows what is there and what could be. */
export const linked = (app: App, name: string): boolean => app.modules.linked().some((mod) => mod.name === name);

/** A link to a row in another fin backend page, as text where that page is not installed. */
export async function rowLink(
  node: Node,
  module: string,
  param: string,
  id: unknown,
  label = `#${id}`,
): Promise<HtmlString> {
  const url = (await backend.toModuleUrl(node, module))({ [param]: id });
  return url ? html`<a href="${url}">${label}</a>` : html`${label}`;
}

/** Where a `ref` of a fin module is shown: its backend page, the parameter, the word for it. */
const REFS: Record<string, [string, string, string]> = {
  "fin.invoice": ["cms.backend.superuser.fin.invoice", "invoice", "invoice"],
  "fin.payment": ["cms.backend.superuser.fin.payment", "payment", "payment"],
};

/** `fin.invoice:7` or `fin.payment:12` as a link where its page is there; anything else as text. */
export async function refLink(node: Node, ref: unknown): Promise<HtmlString | string> {
  const [module, id] = String(ref ?? "").split(":");
  const target = REFS[module];
  if (!target || !id) return String(ref ?? "");
  return rowLink(node, target[0], target[1], id, `${target[2]} #${id}`);
}
