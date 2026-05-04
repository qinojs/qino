# Qino

A modular, TypeScript-first web framework for Deno built on [Hono](https://hono.dev). Qino provides a pluggable module system, a declarative API tree, server-side rendering, database abstraction, and a full CMS out of the box.

## Install

```ts
import { App } from "jsr:@qino/qino";
```

Works with Deno, Bun, and Node.

## Quick Start

```ts
import { Hono } from "npm:hono@^4";
import { App } from "jsr:@qino/qino";

const app = await App.create({
  dbName: "myapp",
  dbUser: "admin",
  dbPass: "secret",
});

// Load all built-in modules
await app.importAll(import.meta.resolve("./module/"));

// Mount into Hono
const hono = new Hono();
hono.route("/cms", app.router);

Deno.serve({ port: 8080 }, hono.fetch);
```

## Core Concepts

### App

The `App` class is the central hub. It manages the database connection, module system, session handling, settings, and HTTP routing.

```ts
const app = await App.create({ dbName, dbUser, dbPass, https? });

await app.importAll(path);          // Load all modules from a directory
await app.import(moduleUrl);        // Load a single module

app.router   // Hono instance — mount this into your server
app.db       // MySQL database connection
app.settings // Hierarchical app-wide settings (backed by item.js)
```

### Modules

Modules are the building blocks of a Qino application. Each module is a `.ts` file that exports a standard interface:

```ts
// my-module/mod.ts
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
          return await ctx.app.db.table("usr").Entry(id);
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
| `cms.frontend.1` | Frontend rendering engine |
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

To use a local version of [item.js](https://github.com/nuxodin/item.js) during development:

```sh
deno task dev:local
```

## License

MIT
