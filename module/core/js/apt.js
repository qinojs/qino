import { AptClient } from "./AptClient.js";

function defaultBase() {
  const el = document.querySelector('script[type="json/c1"]');
  let appURL = globalThis.appURL;
  if (!appURL && el?.textContent) try { appURL = JSON.parse(el.textContent).appURL; } catch { /* not json */ }
  return new URL("api/", location.origin + (appURL ?? "/"));
}

export const apt = new AptClient(defaultBase());
