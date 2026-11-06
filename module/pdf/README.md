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

The HTML is printed without an address, so relative URLs have no base: use absolute ones, a
`<base href>`, or inline what is small (a data URL, an inline SVG).

## The browser

Printed by [browser](../browser/): a page of its own in the running Chromium, so prints run side by
side and take some 30 ms. The HTML is ours, so the page may load from our own server (no guard).
Without margins from `@page` it prints with Chromium's own (0.4 in), backgrounds included.

Without a browser `render` throws, and browser's health check says so.
