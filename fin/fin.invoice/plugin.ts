import { App, getCtx, s } from "@qino/qino";

import { refOf, settle } from "./mod.ts";

import type { EventDecls } from "@qino/qino";

export { default as dbSchema } from "./dbschema.json" with { type: "json" };

Object.assign(App.events, {
  "invoice:status": {
    description: "An invoice was issued, paid, reopened by a refund or canceled — once per change.",
    data: s.object({
      invoice: s.record().describe("The invoice row, after the change."),
      previous: s.string().describe("The status before."),
    }),
  },
} satisfies EventDecls);

export const settingsSchema = {
  properties: {
    number: {
      type: "string",
      default: "{year}-{n}",
      description: "Format of outgoing numbers: {year} and {n}, e.g. R{year}-{n}",
    },
    term: { type: "integer", default: 30, description: "Days until due, unless the invoice says otherwise" },
    taxRate: { type: "number", description: "Tax rate in percent of a line that names none; empty: no tax" },
    creditNumber: {
      type: "string",
      description: "Format of credit note numbers, e.g. G{year}-{n}; empty: they count on with the invoices",
    },
    method: {
      type: "string",
      description: "Payment an issued invoice asks for, e.g. qrbill — its slip then goes with the invoice",
    },
  },
};

export function init(app: App, { signal }: { signal: AbortSignal }): void {
  // its PDF is for the user it is addressed to; everyone else needs a signed link
  app.on("dbFile:access-fallback", async (e) => {
    const usrId = getCtx().userId;
    if (!usrId) return;
    if (await app.db.one`SELECT 1 FROM invoice WHERE file_id = ${e.file.id} AND usr_id = ${usrId}`) e.access = true;
  }, { signal });
  // deno-lint-ignore no-explicit-any -- module events carry their own payloads
  app.on("payment:change", async ({ payment }: any) => {
    const ref = String(payment?.ref ?? "");
    const id = Number(ref.split(":")[1]);
    if (ref === refOf(id)) await settle(app, id);
  }, { signal });
}
