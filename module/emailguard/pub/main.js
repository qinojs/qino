// Restores the mailto hrefs the server encoded. Text addresses need no script at all — they already
// read correctly, and stay broken for anything reading the markup or textContent.
// This file is served at <appUrl>m/emailguard/pub/main.js

const key = JSON.parse(document.querySelector("#qino-data")?.textContent || "{}").emailguard?.key;

if (key) {
  for (const a of document.querySelectorAll('a[href^="mailto:"]')) {
    const href = a.getAttribute("href").slice(7);
    const q = href.indexOf("?");
    const token = q < 0 ? href : href.slice(0, q);
    if (!/^[A-Za-z0-9_-]+$/.test(token)) continue; // a hand-written mailto, not one of ours
    a.setAttribute("href", "mailto:" + decode(token, key) + (q < 0 ? "" : href.slice(q)));
  }
}

function decode(token, key) {
  const bin = atob(token.replace(/-/g, "+").replace(/_/g, "/"));
  let out = "";
  for (let i = 0; i < bin.length; i++) out += String.fromCharCode(bin.charCodeAt(i) ^ key.charCodeAt(i % key.length));
  return out;
}
