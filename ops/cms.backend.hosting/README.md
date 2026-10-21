# cms.backend.hosting

The projects of a server: state, memory, CPU, tasks, disk, restarts, listening sockets and the domains
Caddy proxies to them, with the server's totals. A socket that is not on loopback is flagged: it bypasses
the proxy. Projects can be started, stopped, restarted, created from a template and deleted; creating
and deleting need a fresh passkey (step-up). Deleting archives: directory, unit and Caddy site move to
`/var/backups/qino-hosting/<name>-<time>/`.

A project is a directory in `/var/www/` with a systemd unit of the same name. The managing instance is
the one named like the helper's group; it does not stop or delete itself.

**Not Qino-specific.** The module runs in Qino, but what it manages need not: the helper knows systemd,
Caddy and Linux, never Qino. Qino knowledge goes into a template (like [qino-deno](host/templates/qino-deno/)),
not into the helper or the panel; what a project does inside (updates, its data) is its own business.

## Root helper

Reading other projects and changing them needs root; the managing instance must not have it.
[host/helper.ts](host/helper.ts) does, and answers only fixed verbs on a unix socket that only the
managing instance's group may open. It imports nothing but the runtime.

```sh
mkdir -p /usr/local/lib/qino-hosting
cp -r host/helper.ts host/templates /usr/local/lib/qino-hosting/ && chown -R root: /usr/local/lib/qino-hosting
cp host/qino-hosting.service /etc/systemd/system/   # set Group= to the managing instance's user
systemctl daemon-reload && systemctl enable --now qino-hosting
```

Install copies owned by root: if the managing instance could write what the helper runs, it would be
root. The socket path is the setting `socket` (default `/run/qino-hosting/hosting.sock`). Every request
is logged in the helper's journal, out of the instance's reach.

## Templates

A template is a directory in `templates/`: `files/` is copied into the new project, `unit.service` and
`site.caddy` become its unit and Caddy site, `install.sh` (optional) runs as the project's user in its
directory. `{{name}}`, `{{domain}}`, `{{addresses}}`, `{{port}}` and `{{root}}` are filled in; `install.sh` gets
them as `NAME`, `DOMAIN`, `ADDRESSES`, `PORT` and `ROOT`. The port is the lowest free one from 8090.

With `HOSTING_PREVIEW=preview.example.com` in the helper's unit, `{{addresses}}` adds `<domain>.preview.example.com`:
a project can be looked at before its domain points to the server (a wildcard DNS record covers it).

[qino-deno](host/templates/qino-deno/) clones Qino and starts with `starter.account`. Its first boot writes the
superuser's password to the log (the project's "Log" button). [qino-bun](host/templates/qino-bun/) is the
same on Bun (`/usr/local/bin/bun`), with a `package.json` workspace instead of `deno.json`.
