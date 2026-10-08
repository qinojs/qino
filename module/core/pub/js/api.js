// The app's RPC client, one per tab — on the server: `app.api`.
//
//   await api.core.user.me.get();
import { ApiClient } from "./ApiClient.js";

// The page's data — app url, csrf token —, where nothing read it yet: a frontend page loads no c1.js,
// which does so on the cms's pages. Without the token, every call that writes would be refused.
const el = document.querySelector('#qino-data');
if (!globalThis.qino && el?.textContent) try { globalThis.qino = JSON.parse(el.textContent)?.qino; } catch { /* not json */ }

export const api = new ApiClient(new URL("api/", location.origin + (globalThis.qino?.appUrl ?? "/")));
// Retry only after a step-up the user answered. The dialog is loaded on first use.
api.recover = async (error) =>
  error.code === "step_up_required" && await (await import("./stepUpDialog.js")).stepUp(error.data);
