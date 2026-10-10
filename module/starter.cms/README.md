# starter.cms

A website to start from. Applied once, then everything belongs to the site.

## Getting started

One file, `server.ts`, in an empty folder. Put the newest version from
[jsr.io/@qino/qino](https://jsr.io/@qino/qino) in place of `X.Y.Z`:

```ts
const qino = "https://jsr.io/@qino/qino/X.Y.Z/";

const { App } = await import(qino + "module/core/mod.ts");
const app = new App(); // files and the SQLite database next to this file
app.stores.add(qino + "module/store.json").add("starter.cms");
await app.init();

Deno.serve({ port: 8080 }, app.fetch);
```

```sh
deno run -A server.ts
```

The version is named once: the code and the modules must come from the same release, otherwise
both are loaded twice. The first start downloads everything and takes a minute.

1. The first start prints the superuser's password. It is also kept in
   `data/starter.cms/superuser.txt`, readable only by the server's user.
2. Open <http://localhost:8080/login> and sign in with `su` and that password.
3. Switch on editing with the switch at the top right (or the key E) and click any text.
4. The menu now shows *First steps*, a checklist only editors see: your own account, name and
   logo, sending mail, imprint and privacy policy, languages. Delete the page when it is done.

More starters build on this one. `starter.account` and `starter.ai` are added the same way;
`starter.shop` comes from `qino + "shp3/store.json"`, `starter.fin` from `qino + "fin/store.json"`.

### From a checkout

To work on qino itself, clone it into `qino/` and make it part of the project with a `deno.json`.
item.js is released together with qino, so it may be younger than Deno's minimum age for packages:

```json
{
  "workspace": ["./qino"],
  "minimumDependencyAge": { "age": "P1D", "exclude": ["jsr:@nuxodin/item"] }
}
```

`server.ts` then imports `@qino/qino` and adds `import.meta.resolve("./qino/module/store.json")`.

## What it sets up

| | |
|---|---|
| Layout | `cms.layout.standard.2` on the root, unless the site already chose a layout |
| Pages | Home, Contact (form with name, email and message), Search, Imprint, Privacy policy |
| Editors | First steps |
| System | Layout (page 5), Login with "forgot password", No access, Not found, Trash |
| Footer | links to contact, imprint, privacy policy and search |
| People | the group `admin`, allowed to edit every page, and the superuser `su` |
| Modules | contents, forms, images, file browser, versions, SEO, error reports and the backend |

Titles and texts come in English, German, French and Italian. Imprint and privacy policy are
templates with `[placeholders]`, hidden from the navigation but linked in the footer.

## Starters

A starter is an ordinary module: its `dependencies` are what it brings, its `install()` builds the
content. Other starters build on this one: `starter.account`, `starter.ai`, `starter.shop`,
`starter.fin`. Each adds what it needs to *First steps*.

- **Applied once.** `install()` runs once per app, like any module's.
- **Handed over.** The starter installs its modules as modules of their own, so they stay when the
  starter is removed from `server.ts`, and each can be uninstalled alone.
- **Fills gaps.** Every page carries a name (`home`, `contact`, …) and is only created when no page
  has it. So *repair* on the module page brings back a deleted page and changes nothing else, and a
  starter added to an existing site leaves its pages alone.

[mod.ts](mod.ts) holds what starters share: `adopt()`, `page()`, `section()`, `prose()`, `todo()`.
