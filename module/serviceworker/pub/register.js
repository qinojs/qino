// Registers the app-wide service worker. Its scope is the app root, so a fragment
// can control and focus every page of the app.

// this file is served at <appURL>m/serviceworker/pub/register.js
const appURL = new URL("../../../", import.meta.url).pathname;

navigator.serviceWorker?.register(appURL + "sw.js", { type: "module", scope: appURL })
  .catch((e) => console.warn("service worker registration failed", e));
