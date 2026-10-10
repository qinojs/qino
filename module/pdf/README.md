# pdf

**HTML in, PDF out.** Printed by a headless Chromium, so whatever a page can do works here: CSS,
web fonts, SVG, images, and `@page` for size and margins. Templates and identity CSS exist only
once — the same HTML is a page or a PDF.

```ts
import { render } from "@qino/qino/pdf";

const bytes = await render(app, html`<!doctype html>
  <style>@page { size: A4; margin: 2cm }</style>
  <h1>Invoice 2026-1</h1>`.toString());
```

The HTML is printed from a temporary file, so relative URLs have no base: use absolute ones, a
`<base href>`, or inline what is small (a data URL, an inline SVG).

## The browser

`pdf.browser` names the binary; without it the first installed of `chromium`, `chromium-browser`,
`google-chrome-stable`, `google-chrome` and `microsoft-edge` is used. Each print starts the browser
with its own profile in the module's `tmp/` and removes it afterwards — prints run side by side,
and a service user without a home works. A print takes a moment and around 100 MB while it runs.

Without a browser `render` throws, and the health check says so.
