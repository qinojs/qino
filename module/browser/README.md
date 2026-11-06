# browser

A real browser on the server: headless Chromium, driven by [Playwright](https://playwright.dev).
For agents and users through the api, for modules through `open()` (e.g. [pdf](../pdf/)).

```
open      post { url? }            a page of your own: { id, url, title, snapshot }
goto      post { id, url }         go to an address (http or https)
click     post { id, ref }         click an element, by its ref from the snapshot
fill      post { id, ref, text }   fill a text field
press     post { id, key }         press a key: Enter, Tab, ArrowDown, …
snapshot  get  { id }              what the page shows now
close     post { id }
```

```ts
import { open } from "@qino/qino/browser";

const page = await open(app); // a Playwright Page
try {
  await page.goto("https://example.com/");
  console.log(await page.ariaSnapshot({ mode: "ai" }));
} finally {
  await page.close();
}
```

- **Snapshot:** the page's accessibility tree as text, each element with a `ref` to act on.
- **Guard:** a page only reaches public addresses, every request goes through `safeFetch`; no web
  sockets, service workers or downloads. Pages of our own (`open(app, { guard: false })`) load directly.
- **One Chromium** per binary and runtime; each page has a context of its own (cookies, storage, cache).
  It starts with the first page and ends 30 s after the last.
- **Pages from the api** belong to the user who opened them and close after 10 minutes unused.
  **Signed-in users** only.
- **Needs** Chromium (`browser.executable`, else the first installed of `chromium`,
  `chromium-browser`, `google-chrome-stable`, `google-chrome`, `microsoft-edge`) and the npm package
  `playwright-core` (optional, installed only where used). The health check says what is missing.
