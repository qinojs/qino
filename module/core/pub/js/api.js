// The app's RPC client, one per tab — on the server: `app.api`.
//
//   await api.core.user.me.get();
import { ApiClient } from "./ApiClient.js";

function defaultBase() {
  const el = document.querySelector('#qino-data');
  let appUrl = globalThis.qino?.appUrl;
  if (!appUrl && el?.textContent) try { appUrl = JSON.parse(el.textContent)?.qino?.appUrl; } catch { /* not json */ }
  return new URL("api/", location.origin + (appUrl ?? "/"));
}

export const api = new ApiClient(defaultBase());
// Retry only after a step-up the user answered. The dialog is loaded on first use.
api.recover = async (error) =>
  error.code === "step_up_required" && await (await import("./stepUpDialog.js")).stepUp(error.data);
