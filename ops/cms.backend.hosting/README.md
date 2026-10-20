# cms.backend.hosting

Lists the projects of a server: state, memory, CPU, tasks, disk, restarts, listening sockets and the
domains Caddy proxies to them. A socket that is not on loopback is flagged: it bypasses the proxy.

A project is a directory in `/var/www/` with a systemd unit of the same name.

## Root helper

Reading other projects (their `0750` directories, their processes) needs root; the managing instance
must not have it. [host/helper.ts](host/helper.ts) does, and answers only fixed verbs on a unix socket
that only the managing instance's group may open. It imports nothing but the runtime.

```sh
install -D -o root -g root -m 0644 host/helper.ts /usr/local/lib/qino-hosting/helper.ts
cp host/qino-hosting.service /etc/systemd/system/   # set Group= to the managing instance's user
systemctl daemon-reload && systemctl enable --now qino-hosting
```

Install a copy owned by root: if the managing instance could write the file it runs, it would be root.
The socket path is the setting `socket` (default `/run/qino-hosting/hosting.sock`). Every request is
logged in the helper's journal, out of the instance's reach.
