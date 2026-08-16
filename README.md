# Qino

**The Deno framework for building modern digital platforms.**

Qino brings the technical foundation and the product capabilities of a modern platform into one modular system. Start with a focused API, then add identity, permissions, communication, AI, content management, and operational tools as your application grows.

It stays close to the platform: TypeScript, ESM, Web-standard HTTP, and explicit APIs throughout. A Qino application is still a standard `(Request) => Response` handler—easy to understand, easy to extend, and easy to embed in an existing stack.

## A platform foundation, not just a router

- **Identity and access** — sessions, password and passkey login, WebAuthn step-up authentication, OAuth 2.0 and OpenID Connect for social login, plus API keys and bearer tokens.
- **Users, groups, and permissions** — manage accounts, profiles, memberships, and access rules for anything from a small team to a multi-role platform.
- **Communication** — create, deliver, store, and track email; send browser push notifications; extend the platform with additional channels. SMS, WhatsApp, and Telegram adapters are planned.
- **AI and agent integration** — connect configurable AI providers for chat, OCR, and transcription, and expose your application's declared actions through an MCP server.
- **Content and back office** — build on a complete modular CMS with inline editing, localization, layouts, media handling, administration, and extensible content types.
- **Files and media** — store files, generate variants, and transform media through a unified API.
- **Independent frontend delivery** — proxy and cache approved frontend dependencies locally to reduce runtime reliance on third-party CDNs.
- **Application operations** — settings, scheduled jobs, request lifecycle hooks, error reporting, and other everyday platform concerns fit into the same module system.

Use only what your application needs. Modules work with sensible defaults, declare their dependencies, and remain replaceable as requirements evolve.

## Why Qino

- **Deno-native** — TypeScript, ESM, and Web APIs from end to end.
- **Modular by design** — application features are ordinary modules rather than framework magic.
- **Declarative APIs** — define an action tree once and expose it through HTTP, MCP, or other adapters.
- **Database-ready** — one safe, dialect-aware interface for SQLite, PostgreSQL, and MySQL.
- **Secure foundations** — bound SQL parameters, structured access control, modern authentication, and per-application state.
- **Multi-tenant safe** — multiple independent `App` instances can share one runtime without sharing tenant state.
- **Easy to embed** — run Qino directly or mount it below an existing Hono application.

## Quick start

```ts
import { Access, App } from "jsr:@qino/qino";

const app = new App(); // SQLite by default

app.apiTree = {
  hello: {
    get: {
      description: "Say hello",
      access: Access.PUBLIC,
      execute: () => ({ message: "Hello from Qino" }),
    },
  },
};

await app.init();
Deno.serve(app.fetch);
```

Your endpoint is now available at `GET /api/hello`.

Direct `jsr:` imports, including package subpaths, work without a `deno.json`:

```ts
import { App } from "jsr:@qino/qino@^0.6";
import type { Node } from "jsr:@qino/qino@^0.6/cms";
```

In a project, add Qino once with `deno add jsr:@qino/qino@^0.6` and use its shorter public
entrypoints:

```ts
import { App } from "@qino/qino";
import type { Node } from "@qino/qino/cms";
```

Qino's modules use the same bare entrypoints. The package resolves those self-references locally;
JSR rewrites them to fully qualified specifiers when publishing.

## SQLite, PostgreSQL, or MySQL

Qino uses SQLite by default, with no configuration required. Move to PostgreSQL or MySQL by changing only the connection string:

```ts
const sqlite = new App({ db: "sqlite:/absolute/path/app.sqlite" });
const postgres = new App({ db: "postgresql://user:pass@localhost:5432/app" });
const mysql = new App({ db: "mysql://user:pass@localhost/app" });
```

Queries use tagged templates, so interpolated values become bound parameters automatically:

```ts
const user = await app.db.row`
  SELECT * FROM usr WHERE email = ${email}
`;
```

The same query API is rendered for the active database dialect.

## Declarative by design

Qino's action tree keeps routing, validation, access control, and execution together. The result stays readable and can be adapted to more than one interface.

```ts
import { Access, App, s } from "jsr:@qino/qino";

const app = new App();

app.apiTree = {
  users: {
    ":id": {
      paramSchema: s.number(),
      resolve: (id) => id,
      get: {
        description: "Get a user",
        access: Access.PUBLIC,
        execute: ({ id }) => app.db.row`
          SELECT * FROM usr WHERE id = ${id}
        `,
      },
    },
  },
};
```

This action is available as `GET /api/users/:id` and can also become part of the application's tool surface.

## Web-standard HTTP

`app.fetch` works wherever a standard request handler is accepted:

```ts
Deno.serve({ port: 8080 }, app.fetch);
```

Hono is optional. Use the adapter when you want to mount Qino below an existing route:

```ts
import { Hono } from "npm:hono@^4";
import { App, honoAdapter } from "jsr:@qino/qino";

const app = new App();
await app.init();

const hono = new Hono();
hono.route("/app", honoAdapter(app));

Deno.serve(hono.fetch);
```

## CMS included

Qino's CMS is built from the same modules as the rest of the framework. It adds inline content editing, layouts, reusable content types, localization, files and images, user administration, and a modular backend without turning the core into a monolith.

The CMS currently lives in this repository under [`module/cms`](module/cms/). A dedicated [Qino CMS repository](https://github.com/qinojs/cms) is being prepared.

## Documentation

The [core documentation](module/core/docs/) covers the main building blocks, including [modules](module/core/docs/module.md), [database access](module/core/docs/db.md), and [file transforms](module/core/docs/transform.md).

Further module guides explain [passkeys and WebAuthn](module/auth.webauthn/USAGE.md), [OAuth and social login](module/auth.oauth/USAGE.md), [MCP integration](module/mcp/USAGE.md), [web push](module/messaging.web_push/README.md), and [Telegram](module/messaging.telegram/README.md).

## License

[MIT](LICENSE)
