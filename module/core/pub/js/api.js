// The app's RPC client, one instance for the tab — server-side counterpart: `app.api`.
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
// The one thing worth retrying: a demand for a fresh proof, answered by the user. The dialog is
// loaded the first time that happens — a page that never hits one never fetches it.
api.recover = async (error) =>
  error.code === "step_up_required" && await (await import("./stepUpDialog.js")).stepUp(error.data);
