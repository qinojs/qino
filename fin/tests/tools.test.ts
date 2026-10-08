import { assert } from "@std/assert";
import { toTools } from "@qino/qino";

import { api as fin } from "../fin/api.ts";
import { api as accounting } from "../fin.accounting/api.ts";
import { api as vat } from "../fin.accounting.ch/api.ts";
import { api as bank } from "../fin.bank/api.ts";
import { api as camt } from "../fin.bank.camt/api.ts";
import { api as invoice } from "../fin.invoice/api.ts";
import { api as payment } from "../fin.payment/api.ts";
import { api as credit } from "../fin.payment.credit/api.ts";
import { api as subscription } from "../fin.subscription/api.ts";

Deno.test("every fin api becomes tools, each of its own name", () => {
  const tree = {
    fin,
    "fin.accounting": accounting,
    "fin.accounting.ch": vat,
    "fin.bank": bank,
    "fin.bank.camt": camt,
    "fin.invoice": invoice,
    "fin.payment": payment,
    "fin.payment.credit": credit,
    "fin.subscription": subscription,
  };
  // throws where a list and an item of it, or two routes, would share a name
  assert(toTools(tree).length > 30);
});
