# webapp

`webapp` projects the instance identity into browser metadata and a Web App Manifest.
The public identity remains owned by [`identity`](../identity/): name, alternate name,
description, brand colors and the source icon are read from there. This module owns only
launch behaviour and browser-specific document metadata.

The manifest `id`, `scope` and `start_url` always use the request's application base URL. A
Qino instance represents one web app, so keeping separate settings for those identical values
would introduce unnecessary alternate identities and navigation boundaries.

It serves `manifest.webmanifest`, redirects conventional favicon and Apple touch-icon
requests to the identity icon, and adds the corresponding `<meta>` and `<link>` elements
to rendered HTML. Other modules may extend the generated object in place:

```ts
app.on("webapp:manifest", ({ manifest }) => {
  manifest.shortcuts = [{ name: "Inbox", url: "inbox" }];
}, { signal });
```

## Known limits

- Offline behaviour is deliberately not part of this module. It belongs in a separate
  contributor to [`serviceworker`](../serviceworker/).
- In-page installation prompts and platform-specific installation instructions are not
  implemented. Installation currently uses the browser or operating system's own UI.
- The identity module currently stores one general source icon. Raster dimensions are not
  persisted, so the manifest does not claim generated `192x192` or `512x512` sizes it cannot
  prove. SVG icons are marked `sizes: "any"`; raster icons are published without `sizes`.
  Dedicated maskable and monochrome icon variants are not implemented yet.
- Apple touch-icon and favicon redirects request PNG transforms, but the transformer does
  not upscale small sources and currently leaves SVG sources as SVG. A small uploaded
  identity icon therefore remains small, and an SVG is not rasterized for Apple clients.
- Manifest localization is not implemented because identity strings are not localized yet.
- The legacy health-check warnings for missing operator, theme and background data have no
  counterpart yet. The values can be edited in the Identity backend, but are not enforced.
- Shortcuts, screenshots, maskable icons and other optional manifest extensions have no
  dedicated settings UI. Modules can add them through `webapp:manifest`.
- `SKYPE_TOOLBAR_PARSER_COMPATIBLE` is retained with disabled telephone detection for legacy
  Skype browser integrations; current browsers may ignore it.
- Apple's standalone and status-bar meta elements are non-standard compatibility extensions
  still used by iOS Home Screen web apps. Their exact rendering remains platform-dependent;
  `black-translucent` is still a supported web meta value despite the similarly named native
  UIKit enum being deprecated.
- The backend iframe schematically cycles through a home screen, generated launch screen and
  loaded page. Icon masks, installation surfaces and browser chrome vary by browser, operating
  system and manifest support. The preview leaves the source icon unmasked instead of predicting
  a system treatment. Selecting a preview stage stops the cycle on that stage.
- html.meta["application-name"] = name; not needed anymore