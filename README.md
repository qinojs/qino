# Qino

<p align="center">
  <img src="module/cms.layout.backend/pub/logo.svg" alt="Qino" width="140">
</p>

**The Deno framework for building modern digital platforms.**

Qino is a modular system for web platforms. Start with a small API, then add login, permissions, messaging, AI, a CMS and operational tools as your application grows.

It stays close to the platform: TypeScript, ESM and Web-standard HTTP. A Qino application is a plain `(Request) => Response` handler, so it is easy to understand, extend and embed.

## A platform foundation, not just a router

- **Identity and access** — sessions, password and passkey login, WebAuthn step-up, social login via OAuth 2.0 / OpenID Connect, API keys and bearer tokens.
- **Users, groups, and permissions** — accounts, profiles, memberships and access rules.
- **Communication** — send, store and track email, web push, SMS and Telegram; add your own channels.
- **AI and agents** — configurable AI providers for chat, OCR and transcription; an MCP server exposes your application's actions.
- **Content and back office** — a modular CMS with inline editing, localization, layouts, media and custom content types.
- **Files and media** — store files and generate image variants through one API.
- **Self-hosted frontend assets** — approved CDN dependencies are proxied and cached locally.
- **Operations** — settings, scheduled jobs, request hooks and error reporting, all as modules.

Use only what you need. Modules work without configuration, declare their dependencies and can be replaced.

## Why Qino

- **Deno-native** — TypeScript, ESM, and Web APIs from end to end.
- **Modular** — features are ordinary modules, no framework magic.
- **Declarative APIs** — define an action tree once, serve it over HTTP, MCP or other adapters.
- **Database-ready** — one query API for SQLite, PostgreSQL and MySQL.
- **Secure** — bound SQL parameters, structured access control, modern authentication.
- **Multi-tenant** — several `App` instances share one runtime without sharing state.
- **Embeddable** — run Qino directly or mount it inside a Hono application.

## Quick start

```ts
import { Access, App } from "jsr:@qino/qino@^0.6";

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

In a project, add Qino once with `deno add jsr:@qino/qino@^0.6` and use the short form:

```ts
import { App } from "@qino/qino";
import type { Node } from "@qino/qino/cms";
```

Qino's own modules import the same way; JSR rewrites these imports to full specifiers when publishing.

## SQLite, PostgreSQL, or MySQL

SQLite is the default and needs no configuration. For PostgreSQL or MySQL, change the connection string:

```ts
const sqlite = new App({ db: "sqlite:/absolute/path/app.sqlite" });
const postgres = new App({ db: "postgresql://user:pass@localhost:5432/app" });
const mysql = new App({ db: "mysql://user:pass@localhost/app" });
```

Queries are tagged templates; interpolated values become bound parameters:

```ts
const user = await app.db.row`
  SELECT * FROM usr WHERE email = ${email}
`;
```

The query is rendered for the active database dialect.

## Declarative by design

The action tree keeps routing, validation, access control and execution in one place, and can be served over more than one interface.

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

This action is available as `GET /api/users/:id` and, for example, as an MCP tool.

## Web-standard HTTP

`app.fetch` works wherever a standard request handler is accepted:

```ts
Deno.serve({ port: 8080 }, app.fetch);
```

Hono is optional. Use the adapter to mount Qino below an existing route:

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

The CMS is built from ordinary modules: inline editing, layouts, content types, localization, files and images, user administration and a modular backend. The core stays small.

The CMS currently lives in this repository under [`module/cms`](module/cms/). A dedicated [Qino CMS repository](https://github.com/qinojs/cms) is being prepared.

## Documentation

The [core documentation](module/core/docs/) covers [modules](module/core/docs/module.md), [database access](module/core/docs/db.md) and [file transforms](module/core/docs/transform.md).

Module guides: [authentication](module/auth/README.md) — [passkeys](module/auth.webauthn/USAGE.md), [social login](module/auth.oauth/USAGE.md), [authenticator apps](module/auth.totp/README.md), [backup codes](module/auth.backup_codes/README.md) — [MCP](module/mcp/USAGE.md), [web push](module/messaging.webpush/README.md) and [Telegram](module/messaging.telegram/README.md).

## License

[MIT](LICENSE)
