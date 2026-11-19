# cms.backend.hosting

The projects of a server: state, memory and file cache, CPU, tasks, disk, restarts, listening sockets and the domains
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
sh host/setup.sh <managing instance> [preview domain]   # as root, on every update again
```

[host/setup.sh](host/setup.sh) copies helper and templates to `/usr/local/lib/qino-hosting/`, installs
[the unit](host/qino-hosting.service) with `Group=` set to the managing instance, and turns on
[automatic updates](#updates). Install copies owned by root: if the managing instance could write what the helper runs, it would be
root. The socket path is the setting `socket` (default `/run/qino-hosting/hosting.sock`). Every request
is logged in the helper's journal, out of the instance's reach.

## Updates

The server updates itself: `setup.sh` turns on unattended-upgrades (apt) or dnf-automatic (dnf) for every
package source, not only security updates, and reboots at 03:30 when an update needs it (kernel, libc).
The panel shows pending packages, whether a reboot is due and the runtimes the projects start (Bun and Deno
are no packages: `bun upgrade`, `deno upgrade`). Installing and rebooting by hand need a step-up; the
install runs outside the helper's cgroup, so a service restart during it does not cut it off.

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

Both read `/etc/qino-hosting/env` if it exists (root only, systemd reads it). `QINO_SHARED_STORE` there names a
store every site on the server loads, e.g. `/srv/qino-shared/store.json`. Its modules live outside the project,
so they reach Qino through the app (`app.modules.get(name).source`), not through `import "@qino/qino"`.
