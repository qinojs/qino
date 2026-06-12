# Qino

Simple, declarative Deno framework — pluggable modules, batteries included.

## Install

```ts
import { App } from "jsr:@qino/qino";
```

## Quick Start

```ts
import { Hono } from "npm:hono@^4";
import { App } from "jsr:@qino/qino";

const app = new App({
  dbName: "myapp",
  dbUser: "admin",
  dbPass: "secret",
});

// Load all built-in modules
await app.importAll(import.meta.resolve("./module/"));

// Boot: ensure DB, migrate schema, init modules — once, before serving
await app.init();

// Mount into Hono
const hono = new Hono();
hono.route("/cms", app.router);

Deno.serve({ port: 8080 }, hono.fetch);
```

## Core Concepts

### App

The `App` class is the central hub. It manages the database connection, module system, session handling, settings, and HTTP routing.

```ts
const app = new App({ dbName, dbUser, dbPass, https? });

await app.importAll(path);          // Load all modules from a directory
await app.import(pluginUrl);        // Load a single Qino plugin
await app.init();                   // Boot: ensure DB, migrate schema, init modules

app.router   // Hono instance — mount this into your server
app.db       // MySQL database connection
app.settings // Hierarchical app-wide settings (backed by item.js)
```

### Modules

Modules are the building blocks of a Qino application. A module exposes its public API through `mod.ts`. Its optional Qino integration lives in `plugin.ts` and exports the plugin contract:

```ts
// my-module/plugin.ts
export const name = "my-module";
export const needs = ["core"];       // Dependencies

export const dbSchema = { ... };     // Optional: database tables

export function init(app: App) {
  // Called once at startup
}

export const api: Tree = {
  hello: {
    get: {
      description: "Say hello",
      execute: async () => "Hello!",
    }
  }
};
```

Modules are loaded in dependency order and can define database schemas, API endpoints, settings, and event listeners.

### API Tree (apt)

The `Tree` system lets you define APIs declaratively. The same tree is automatically exposed as REST routes, and can be adapted for LLM tools or other interfaces:

```ts
import { type Tree } from "jsr:@qino/qino";

export const api: Tree = {
  users: {
    get: {
      description: "List all users",
      execute: async (_, ctx) => {
        return await ctx.app.db.table("usr").all();
      }
    },
    ":id": {
      get: {
        description: "Get a user by ID",
        input: s.object({ id: s.string() }),
        execute: async ({ id }, ctx) => {
          return await ctx.app.db.table("usr").entry(id);
        }
      }
    }
  }
};
```

This generates routes `GET /users` and `GET /users/:id` automatically.

### Request Context

Every request has an isolated `RequestContext` accessible via `getCtx()`:

```ts
import { getCtx } from "jsr:@qino/qino";

const ctx = getCtx();

ctx.user         // Current authenticated user (or null)
ctx.session      // Session data
ctx.settings     // Per-user/session settings
ctx.get          // Query parameters
ctx.post         // Request body
ctx.cookie       // Cookies
```

### Built-in Modules

| Module | Description |
|--------|-------------|
| `core` | Foundation: settings, auth, sessions, database |
| `cms` | Content management: pages, versioning, access control |
| `cms.backend` | Admin UI: user management, module configuration |
| `cms.frontend.2` | Frontend rendering engine |
| `cms.cont.text` | Rich text content |
| `cms.cont.image2` | Image content with transforms |
| `cms.cont.nav3` | Navigation menus |
| `cms.cont.login4` | Login forms |
| `ai` | AI integration (chat, content generation) |
| `fileEditor` | In-browser code editor |
| `git` | Git integration |
| `error_report` | Error tracking |

## Local Development

Clone the repo and run the demo:

```sh
git clone https://github.com/nuxodin/qino
cd qino/demo
deno task dev
```

## License

MIT
