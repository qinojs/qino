import { call, SaferpayError, settings } from "./api.ts";

import type { Row } from "@qino/qino";
import type { Provider, State } from "@qino/qino/fin.payment";

/** What a refused Assert means for the payment; `null`: not decided yet. Anything else is ours to
 *  look at (credentials, validation) and is thrown. */
const REFUSED: Record<string, State["status"] | null> = {
  TRANSACTION_NOT_STARTED: null,
  TOKEN_EXPIRED: "expired",
  TRANSACTION_ABORTED: "canceled",
  TRANSACTION_DECLINED: "failed",
  GENERAL_DECLINED: "failed",
  "3DS_AUTHENTICATION_FAILED": "failed",
  BLOCKED_BY_RISK_MANAGEMENT: "failed",
  PAYER_AUTHENTICATION_REQUIRED: "failed",
  CARD_CHECK_FAILED: "failed",
  CARD_CVC_INVALID: "failed",
  CARD_CVC_REQUIRED: "failed",
  PAYMENTMEANS_INVALID: "failed",
  PAYMENTMEANS_NOT_SUPPORTED: "failed",
};

/** A refused call as state, or thrown when it is ours to look at. */
function refused(e: unknown): State {
  if (!(e instanceof SaferpayError) || !(e.code in REFUSED)) throw e;
  const status = REFUSED[e.code];
  return status ? { status } : {};
}

const dataOf = (payment: Row): Record<string, string> => JSON.parse(String(payment.data ?? "{}")) ?? {};

/** Saferpay Payment Page: the payer pays on Saferpay's page, the payment is captured right after. */
export const paymentProvider: Provider = {
  name: "saferpay",
  label: "Saferpay",

  async methods(app) {
    const { methods } = await settings(app);
    if (!methods.length) return [{ name: "", label: "Saferpay" }];
    return methods.map((name) => ({ name: name.toLowerCase(), label: name }));
  },

  async start(app, payment, urls) {
    const { terminalId, methods } = await settings(app);
    const chosen = payment.method ? [String(payment.method).toUpperCase()] : methods;
    const res = await call(app, "PaymentPage/Initialize", {
      TerminalId: terminalId,
      Payment: {
        Amount: { Value: String(payment.amount), CurrencyCode: payment.currency },
        OrderId: String(payment.id),
        Description: String(payment.title ?? payment.ref ?? payment.id),
      },
      PaymentMethods: chosen.length ? chosen : undefined,
      ReturnUrl: { Url: urls.back },
      Notification: { SuccessNotifyUrl: urls.notify, FailNotifyUrl: urls.notify },
    });
    return { redirect: res.RedirectUrl, externalId: res.Token, data: { token: res.Token } };
  },

  // Saferpay asks not to poll Assert: it runs on return and notification, the cron only backs off
  async sync(app, payment) {
    if (payment.status !== "pending" && payment.status !== "processing") return {};
    const data = dataOf(payment);
    const res = await call(app, "PaymentPage/Assert", { Token: data.token }).catch(refused);
    if (!res.Transaction) return res;
    const tx = res.Transaction;
    const state: State = {
      externalId: tx.Id,
      method: String(res.PaymentMeans?.Brand?.PaymentMethod ?? "").toLowerCase() || undefined,
      data: { ...data, transaction: tx.Id },
    };
    if (tx.Status === "CANCELED") return { ...state, status: "canceled" };
    if (tx.Status === "PENDING") return { ...state, status: "processing" };
    let capture = tx.CaptureId;
    if (tx.Status === "AUTHORIZED") {
      const captured = await call(app, "Transaction/Capture", { TransactionReference: { TransactionId: tx.Id } })
        .catch((e) => {
          // a concurrent sync captured it first and stores the result
          if (e instanceof SaferpayError && e.code === "TRANSACTION_ALREADY_CAPTURED") return;
          throw e;
        });
      if (!captured) return {};
      if (captured.Status !== "CAPTURED") return { ...state, status: "processing" };
      capture = captured.CaptureId;
    }
    return { ...state, status: "paid", paid: Number(tx.Amount.Value), data: { ...state.data, capture } };
  },

  // a refund is authorized first and only done once captured
  async refund(app, payment, amount) {
    const data = dataOf(payment);
    const res = await call(app, "Transaction/Refund", {
      Refund: { Amount: { Value: String(amount), CurrencyCode: payment.currency } },
      CaptureReference: { CaptureId: data.capture },
    });
    if (res.Transaction.Status === "AUTHORIZED") {
      await call(app, "Transaction/Capture", { TransactionReference: { TransactionId: res.Transaction.Id } });
    }
    return {};
  },
};
