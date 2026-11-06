# browser

A real browser on the server: headless Chromium. For agents and users through the api, for modules
through `open()` (e.g. [pdf](../pdf/)).

```
open        post { url? }                    a page of your own: { id, url, title, snapshot }
goto        post { id, url }                 go to an address (http or https)
back        post { id }                      back to the page before
click       post { id, ref }                 click an element, by its ref from the snapshot
fill        post { id, ref, text }           fill a text field
select      post { id, ref, values }         choose in a list
hover       post { id, ref }                 move the mouse over an element
press       post { id, key }                 press a key: Enter, Tab, PageDown, …
tab         post { id, index }               act in another tab
dialog      post { id, accept, text? }       answer an alert, confirm or prompt
snapshot    get  { id }                      what the page shows now
screenshot  get  { id, fullPage?, ref?,      how it looks, as ai's image Part: { type: "image", url } (jpeg);
                   x?, y?, width?, height? }   the view or the whole page small, a zoom on an element or an
                                               area (pixels of the page) as it is, in better quality
console     get  { id }                      its console since it opened
network     get  { id, failed? }             its requests: method, url, type, status or error
close       post { id }
```

Every action answers with what the page shows then: the `snapshot`, and only when there is
something to tell `console` (new warnings and errors), `tabs` (when more than one is open) and
`dialog` (one waiting, which holds the page: then nothing else). What is big or seldom needed —
screenshot, all of the console, the requests — is asked for.

```ts
import { open } from "@qino/qino/browser";

const page = await open(app);
try {
  await page.goto("https://example.com/");
  console.log(await page.snapshot());
} finally {
  await page.close();
}
```

- **Page:** a part of Playwright's Page, with its names: `goto`, `goBack`, `setContent`, `evaluate`,
  `title`, `url`, `pdf`, `screenshot` (also by `ref`; `maxSize`: rendered smaller), `keyboard.press`,
  `setDefaultTimeout`, `waitForLoadState`, `consoleMessages`, `requests`, `on("close")`, `close`. For
  agents also `snapshot()`, the accessibility tree as text with a `ref` for each element; `click`,
  `fill`, `selectOption`, `hover` by those refs; `tabs`/`tab`, `handleDialog`, and `news()`, what an
  action answers with.
- **Failures** through the api are told as they are (a `ConflictError` with the browser's words: a
  timeout, an element gone, a name not found), so a model can go on from them.
- **Drivers:** [Playwright](lib/playwright.ts) where it loads (Node, Bun, Deno with `--allow-all`): its
  snapshot is what agents know. Else [Puppeteer](lib/puppeteer.ts) (Deno with the usual flags and
  `--allow-env`). Both give the same [Page](lib/Page.ts).
- **Guard:** a page only reaches public addresses: the browser goes through a local proxy that checks
  each address and connects to the one checked (core `publicIps`), and WebRTC cannot go past it. No
  downloads. Pages of our own (`open(app, { guard: false })`) load directly.
- **One Chromium** per binary and runtime; each page has a context of its own (cookies, storage, cache).
  It starts with the first page and ends 30 s after the last.
- **Pages from the api** belong to the user who opened them and close after 10 minutes unused.
  **Signed-in users** only.
- **Needs** Chromium (`browser.executable`, else the first installed of `chromium`,
  `chromium-browser`, `google-chrome-stable`, `google-chrome`, `microsoft-edge`) and `playwright-core`
  or `puppeteer-core` (optional npm packages, installed only where used). The health check says what
  is missing.
