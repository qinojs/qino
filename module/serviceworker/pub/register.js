// Registers the app-wide service worker. Its scope is the app root, so a fragment
// can control and focus every page of the app.

// this file is served at <appUrl>m/serviceworker/pub/register.js
const appUrl = new URL("../../../", import.meta.url).pathname;

navigator.serviceWorker?.register(appUrl + "sw.js", { type: "module", scope: appUrl })
  .catch((e) => console.warn("service worker registration failed", e));
