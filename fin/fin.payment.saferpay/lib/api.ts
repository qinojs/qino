import { errMsg, isOn } from "@qino/qino";

import type { App } from "@qino/qino";

const SPEC = "1.54";

/** A refusal by Saferpay; `code` is its `ErrorName`, e.g. `TRANSACTION_DECLINED`. */
export class SaferpayError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(`fin.payment.saferpay: ${code}${message ? ` — ${message}` : ""}`);
    this.code = code;
  }
}

// Settings are read leaf by leaf: awaiting a branch does not guarantee its children are loaded.
const str = async (value: unknown) => String(await value ?? "");

export async function settings(app: App) {
  const s = app.settings["fin.payment.saferpay"];
  const [customerId, terminalId, user, password, live, methods] = await Promise.all([
    str(s.customerId), str(s.terminalId), str(s.user), str(s.password), s.live, str(s.methods),
  ]);
  return {
    customerId,
    terminalId,
    user,
    password,
    base: isOn(live) ? "https://www.saferpay.com/api" : "https://test.saferpay.com/api",
    methods: methods.split(",").map((m) => m.trim().toUpperCase()).filter(Boolean),
  };
}

/** POST to `/Payment/v1/<path>`; resolves with the response, throws `SaferpayError` on a refusal. */
// deno-lint-ignore no-explicit-any
export async function call(app: App, path: string, body: Record<string, unknown>): Promise<any> {
  const { customerId, user, password, base } = await settings(app);
  if (!customerId || !user || !password) {
    throw new Error("fin.payment.saferpay: customerId, user and password are required");
  }
  const res = await fetch(`${base}/Payment/v1/${path}`, {
    method: "POST",
    headers: {
      authorization: `Basic ${btoa(`${user}:${password}`)}`,
      "content-type": "application/json; charset=utf-8",
      accept: "application/json",
    },
    body: JSON.stringify({
      RequestHeader: { SpecVersion: SPEC, CustomerId: customerId, RequestId: crypto.randomUUID(), RetryIndicator: 0 },
      ...body,
    }),
  }).catch((e) => {
    throw new Error(`fin.payment.saferpay: unreachable — ${errMsg(e)}`);
  });
  const json = await res.json().catch(() => ({}));
  if (res.ok) return json;
  throw new SaferpayError(String(json.ErrorName ?? res.status), String(json.ErrorMessage ?? ""));
}
