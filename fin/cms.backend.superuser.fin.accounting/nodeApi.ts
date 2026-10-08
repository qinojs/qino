import { errMsg } from "@qino/qino";
import { backend } from "@qino/qino/cms.backend";
import { parseAmount } from "@qino/qino/cms.backend.superuser.fin";
import { account, book, close, reopen, reverse } from "@qino/qino/fin.accounting";

import type { Node } from "@qino/qino/cms";
import type { AccountType } from "@qino/qino/fin.accounting";

/** Node access is the permission — whoever may open this backend page may book. */
export default async function api(node: Node, vars: Record<string, unknown>): Promise<unknown> {
  const app = node.app;
  const t = app.t;
  try {
    if (vars.book) {
      const v = vars.book as Record<string, string>;
      const currency = String(await app.settings["fin.accounting"].currency ?? "");
      const lines = Object.keys(v).filter((key) => /^account\d+$/.test(key) && v[key]).map((key) => {
        const i = key.slice(7);
        const amount = parseAmount(v[`debit${i}`] || 0, currency) - parseAmount(v[`credit${i}`] || 0, currency);
        return { account: v[key], amount };
      });
      const id = await book(app, { date: v.date, text: v.text, lines });
      return { ok: true, url: backend.toUrl(await (await node.page()).url(), { entry: id }) };
    }
    if (vars.close) {
      await close(app, String((vars.close as Record<string, string>).until));
      return { ok: true };
    }
    if (vars.reopen) {
      await reopen(app);
      return { ok: true };
    }
    if (vars.reverse) {
      const id = await reverse(app, Number(vars.reverse));
      return { ok: true, url: backend.toUrl(await (await node.page()).url(), { entry: id }) };
    }
    if (vars.account) {
      const { number, name, type } = vars.account as Record<string, string>;
      await account(app, number, { name, type: type as AccountType });
      return { ok: true, message: `${await t`Account`} ${number}` };
    }
    return null;
  } catch (e) {
    return { ok: false, message: errMsg(e) };
  }
}
