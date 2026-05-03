# apt — Action Tree

Ein verschachtelter Baum beschreibt die gesamte API. Adapter für REST (Hono), LLM-Tools und RPC werden **on the fly** aus dem Baum abgeleitet.

**Dateien:**
- `m/core/lib/apt.ts` — Framework (toHono, toTools, client, invoke, Fehlerklassen)
- `m/core/lib/schema.ts` — Minimaler Standard-Schema-Validator
- `m/cms/apt.ts` — CMS-spezifischer Baum
- `m/core/tests/` — Tests und Smoke-Checks

---

## Baum-Struktur

```typescript
export const api = {
  // Literal-Segment
  tree: {
    get: { description: "...", execute: (params, ctx) => ... },
  },

  page: {
    // :param-Segment — resolve lädt die Ressource
    ":page": {
      resolve: async (id, ctx) => {
        const page = await (ctx.app as any).cms.page(parseInt(id));
        if (!page.is())          throw new NotFoundError();
        if (await page.access() < 1) throw new AccessError();
        return page;          // landet als params.page in allen Kindern
      },

      get:    { description: "...", execute: ({ page }) => ... },
      delete: { description: "...", execute: ({ page }) => ... },

      // Kind-Segment (kein besonderes Keyword nötig)
      copy: {
        post: {
          description: "...",
          input:  s.object({ deep: s.boolean().default(false) }),
          output: s.object({ id: s.string() }),
          execute: async ({ page, deep }, ctx) => { ... },
        },
      },

      // Mehrere :params in einer Kette
      "online-start": {         // quoted key → Dash im URL erhalten
        put: { execute: ({ page, value }) => ... },
      },

      access: {
        put: { ... },           // PUT /page/:page/access
        users: {
          ":user": {            // kein resolve nötig → params.user = raw string
            put: { ... },      // PUT /page/:page/access/users/:user
          },
        },
      },
    },
  },
};
```

### Reservierte Keywords auf Knoten-Ebene

| Key | Bedeutung |
|---|---|
| `get` `post` `put` `delete` `patch` | HTTP-Verb → Aktion |
| `resolve` | Ressource laden (nur auf `:param`-Knoten) |

Alles andere = Kind-Pfad-Segment.

Innerhalb eines Verb-Objekts reserviert: `description`, `input`, `query`, `output`, `execute`.

### Kollisions-Regel

`params` ist ein **flaches Objekt**. Alle Quellen landen darin:
- aufgelöste `:param`-Segmente → `params.page`, `params.user`, …
- Body-Felder (`input`) → `params.deep`, `params.value`, …
- Query-Felder (`query`) → `params.target`, …

Namens-Kollisionen zwischen diesen Quellen sind ein Setup-Fehler und werden beim ersten `toHono()`/`toTools()`-Aufruf gemeldet (kein Request nötig).

---

## Schema (`m/core/lib/schema.ts`)

Minimaler [Standard-Schema](https://standardschema.dev)-kompatibler Validator — browser-tauglich, null Dependencies. Jede andere Standard-Schema-kompatible Library (Zod, Valibot, …) kann stattdessen verwendet werden.

```typescript
import { s } from "../core/lib/schema.ts";

s.string()
s.number()
s.boolean()
s.object({ deep: s.boolean().default(false), lang: s.optional(s.string()) })
s.array(s.string())
s.optional(s.string())
s.record()           // Record<string, unknown>
s.record(s.number()) // Record<string, number>
```

Optional-Felder in `s.object()` werden korrekt als TypeScript-optional inferiert.

`.default(value)` liefert den Default wenn der Wert `undefined` ist.

---

## Verb-Aktion

```typescript
{
  description?: string,   // für LLM-Tool + Doku
  input?: Schema,         // POST/PUT/PATCH → Body; GET/DELETE → Query-String
  query?: Schema,         // explizite Query-Params bei POST/PUT/PATCH (zusätzlich zu input)
  output?: Schema,        // Rückgabe-Validierung (nur Logging, nicht blockend)
  execute(params, ctx): unknown | Promise<unknown>,
}
```

**`params`** enthält beim `execute`-Aufruf:
- alle aufgelösten `:param`-Werte (`page`, `user`, …)
- alle validierten Input/Query-Felder (`deep`, `lang`, `value`, …)

**`ctx`** ist der `RequestContext` — `ctx.user`, `ctx.lang`, `ctx.app`, …

---

## Access-Regel

Access ist **imperativ** — kein deklaratives `access:`-Feld, keine Vererbung.

**Zwei Stellen:**
1. **`resolve`** — wirft `AccessError` wenn der User die Ressource nicht mal sehen darf. Die gesamte Kette bricht sofort ab, `execute` läuft nie.
2. **`execute`** — prüft aktionsspezifische Rechte (editieren, löschen, verschieben-von/nach, …).

```typescript
// resolve: kann die Ressource überhaupt gesehen werden?
resolve: async (id, ctx) => {
  const page = await (ctx.app as any).cms.page(parseInt(id));
  if (!page.is())          throw new NotFoundError();
  if (await page.access() < 1) throw new AccessError();
  return page;
},

// execute: braucht diese Aktion mehr Rechte?
execute: async ({ page }) => {
  if (await page.access() < 2) throw new AccessError();
  ...
},
```

---

## Response-Regel

`execute` gibt **beliebige Werte** zurück. Kein JSON-Encoding, kein Status-Code — das macht der Adapter.

| Adapter | Erfolg | `undefined` |
|---|---|---|
| REST (toHono) | `200 + JSON` | `204 No Content` |
| RPC (client) | Wert direkt | `undefined` |
| LLM (toTools) | `JSON.stringify(result)` | `"null"` |

**Fehler** = Exceptions:

```typescript
export class AccessError    extends Error { status = 403; }
export class NotFoundError  extends Error { status = 404; }
export class ValidationError extends Error { status = 422; issues: ... }
```

Der REST-Adapter übersetzt `error.status` in den HTTP-Status-Code. RPC wirft weiter. LLM gibt `{ error: message }` als Tool-Result zurück.

---

## Query-Parameter

- **GET / DELETE**: `input`-Schema = Query-String (kein Body). Strings werden automatisch zu `boolean`/`number` geparst wenn das Schema das erfordert.
- **POST / PUT / PATCH**: `input`-Schema = Body. Optionaler `query:`-Block für zusätzliche Query-Params.

```typescript
post: {
  input: s.object({ fields: s.optional(s.array(s.string())) }),  // body
  query: s.object({ target: s.string(), style: s.optional(s.string()).default("neutral") }), // query
  execute: ({ fields, target, style }) => ...,
}
// → POST /path?target=de&style=casual  +  body { "fields": [...] }
```

---

## Adapter

### toHono — REST

```typescript
import { toHono } from "../core/lib/apt.ts";
import { api } from "./apt.ts";

const app = toHono(api);
// oder in server.ts:
const aptApp = new Hono();
aptApp.route("/api", toHono(api));
```

Generierte Routen (Beispiele):
```
GET  /page/:page
POST /page/:page/copy
GET  /page/:page/file/:file/meta
```

### toTools — LLM

```typescript
import { toTools } from "../core/lib/apt.ts";

const tools = toTools(api);
// nur bestimmte Routen:
const tools = toTools(api, { filter: (path) => path.startsWith("/page") });
```

Tool-Namen werden camelCase aus dem Pfad + Verb gebildet:
```
GET /page/:page/files  →  getPageFiles
POST /page/:page/copy  →  postPageCopy
```

### client — RPC-Proxy

```typescript
import { client } from "../core/lib/apt.ts";

const rpc = client(api);

await rpc.page(42).get();
await rpc.page(42).copy.post({ deep: true });
await rpc.page(42).file("logo.png").meta.get();
// POST mit Query-Params:
await rpc.page(42).meta.translate.post(
  { fields: ["alt"] },          // body
  { target: "de" },             // query
);
```

### invoke — direkter Aufruf

```typescript
import { invoke } from "../core/lib/apt.ts";

const result = await invoke(api, "POST", "/page/42/copy", { deep: true });
```

Nützlich für serverInterface-Shims, Tests, dynamische Dispatch.

---

## Neuen Baum anlegen

Jedes Modul kann einen eigenen Baum definieren und in `server.ts` einhängen:

```typescript
// m/meinmodul/apt.ts
export const api = {
  artikel: {
    ":artikel": {
      resolve: ...,
      get:    { ... },
      delete: { ... },
    },
  },
};
```

```typescript
// server.ts oder init
const aptApp = new Hono();
aptApp.route("/api", toHono(cmsApi));
aptApp.route("/api", toHono(meinModulApi));  // merged
```

---

## Wiring in server.ts

```typescript
if (ctx.appRequestUri.startsWith("api/")) {
    const url = new URL(c.req.raw.url);
    url.pathname = "/api/" + ctx.appRequestUri.slice("api/".length);
    const res = await aptApp.fetch(new Request(url, c.req.raw));
    const headers = new Headers(res.headers);
    if (isNew) {
        const cookie = [`qgSession=${ctx.sessionToken}`, `Path=${ctx.appURL}`, "HttpOnly", "SameSite=Lax", ...].join("; ");
        headers.append("Set-Cookie", cookie);
    }
    return new Response(res.body, { status: res.status, headers });
}
```

Der Pathname-Rewrite stellt sicher, dass `aptApp` immer `/api/…` sieht — unabhängig vom `appURL`-Prefix der Installation.
