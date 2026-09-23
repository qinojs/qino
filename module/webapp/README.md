# webapp

`webapp` turns the site identity into browser metadata and a Web App Manifest. Name, alternate
name, description, colors and icon come from [`identity`](../identity/); this module only adds
launch behaviour and browser-specific metadata.

The manifest's `id`, `scope` and `start_url` are always the app's base URL — one Qino instance is
one web app, so no settings for them.

It serves `manifest.webmanifest`, redirects the usual favicon and Apple touch-icon requests to the
identity icon, and adds the `<meta>` and `<link>` elements to HTML pages. Modules can extend the
manifest:

```ts
app.on("webapp:manifest", ({ manifest }) => {
  manifest.shortcuts = [{ name: "Inbox", url: "inbox" }];
}, { signal });
```

## Known limits

- No offline support here; that belongs in a separate [`serviceworker`](../serviceworker/) part.
- No in-page install prompt or install instructions; the browser's own UI is used.
- `identity` stores one icon without known pixel size, so the manifest claims no `192x192` or
  `512x512`. SVG icons get `sizes: "any"`, raster icons no `sizes`. No maskable or monochrome
  variants yet.
- Favicon and Apple touch-icon redirects request PNGs, but small raster icons are not upscaled.
  SVGs are rendered to size with librsvg (or Inkscape); without them the SVG is sent as is and
  Apple devices show no icon.
- No manifest localization, since identity texts aren't localized yet.
- The old health-check warnings for missing operator, theme and background data are not ported.
  The values can be edited in the Identity backend but aren't required.
- No settings UI for shortcuts, screenshots and other optional manifest fields; modules can add
  them via `webapp:manifest`.
- `SKYPE_TOOLBAR_PARSER_COMPATIBLE` (telephone detection off) is kept for old Skype browser
  plugins; current browsers ignore it.
- Apple's standalone and status-bar meta tags are non-standard but still used by iOS home screen
  apps; `black-translucent` is still valid there.
- The backend preview cycles through home screen, launch screen and loaded page. It is only a
  sketch — real icon masks and browser chrome differ per platform, so the icon is shown unmasked.
  Clicking a stage stops the cycle there.
- html.meta["application-name"] = name; not needed anymore