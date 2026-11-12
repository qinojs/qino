# Translations: `t`

The same `t` on the server (`app.t`) and in the browser (`import { t } from "@qino/pub/t.js"`):

```ts
t`Save`                         // the scope's namespace, else the global one ("")
t`Hello ${name}`                // values fill {0}, {1}… of the original "Hello {0}"
t.in("cms")`Save`               // in the namespace cms
const t = app.t.in("cms.shop"); // bound, e.g. for a whole module
t.with("cms", () => render())   // everything fn translates — on the server also after await
t.with({ ns: "fin", lang: "fr" }, fn)
```

In the browser `t.with` holds for the `t` calls `fn` makes synchronously; after an `await`, use `t.in`.
There `t` returns a promise that already renders as a string (the known text, until the answer comes).

## Where a text comes from

The originals are English. A text is looked up in the language of the request, then in the site's other
languages by their order (`core.langs`, e.g. `de, en, fr`); in each, the namespace before the global one.
English ends the search — there the original is the text. Found nowhere: the original (in dev mode marked
`*…*`).

The language of a namespace can differ: a user's `core.lang_ns[ns]` (the panel's CMS language) holds for
every `t` in that namespace, if it is a site language. `ctx.lang` stays the page's.

## Data

`smalltext (hash, namespace, original, count)` lists the texts, `smalltext_lang (hash, namespace, lang, text)`
their translations — any language, also one the site does not offer yet. A text `t` meets that no namespace
in reach knows is added in the background, so it can be translated (cms.backend.config.translate).

Each module seeds its namespace from `locale/<lang>.json` (`{ "original": "text" }`; core: the global one).
It only fills what is missing, never overwrites; `cms.backend.config.translate.export` writes the files back.

Per namespace and language one index is loaded the first time it is needed and kept: a `t` of a known text
is a map lookup. After writing `smalltext` directly, call `app.languages.clear()`.

## Counter

`app.languages.onUse(ns, original)` is called with each lookup. The `dev` module counts them in
`smalltext.count` while `core.smalltext.counter` is on, for "delete unused" in the translate backend.

## Migration

PHP's `smalltext` had a column per language. On the first start, core moves them to `smalltext_lang` and
drops the columns.
