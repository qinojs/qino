# Qino

**The compact, database-ready application core for Deno.**

Qino gives you a clean foundation for building durable web applications: Web-standard HTTP, declarative APIs, sessions, authentication, settings, file handling, and a unified database layer for SQLite, PostgreSQL, and MySQL.

It stays close to the platform. A Qino app is a standard `(Request) => Response` handler, runs directly on `Deno.serve`, and remains easy to embed in an existing stack. Sensible defaults get you started immediately while explicit APIs keep the system predictable as your application grows.

A complete CMS built on Qino is already available.

## Why Qino

- **Deno-native** — TypeScript, ESM, and Web APIs from end to end.
- **Framework-free core** — use Qino directly or mount it in Hono when needed.
- **Declarative APIs** — define an action tree once and expose it as validated HTTP endpoints.
- **Database-ready** — one safe, dialect-aware interface for SQLite, PostgreSQL, and MySQL.
- **Built for real applications** — sessions, authentication, settings, files, localization, and request lifecycle hooks are part of the foundation.
- **Easy to operate** — explicit initialization keeps schema work out of the request path.
- **Multi-tenant safe** — state belongs to each `App` instance, so multiple applications can share one runtime.

## Install

```ts
import { App } from "jsr:@qino/qino";
```

## Quick Start

```ts
import { Access, App } from "jsr:@qino/qino";

const app = new App(); // SQLite by default

app.aptTree = {
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

## One Core, Three Databases

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

## Declarative by Design

Qino's action tree keeps routing, validation, access control, and execution together. The result is an API that remains readable and can also be adapted to other interfaces.

```ts
import { Access, App, s } from "jsr:@qino/qino";

const app = new App();

app.aptTree = {
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

This action is available as `GET /api/users/:id`.

## Web-Standard HTTP

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

## License

[MIT](LICENSE)
