// The root side of cms.backend.hosting: answers a fixed set of verbs on a unix socket.
// No dependencies but the runtime, so nothing else runs as root. Runs on Node, Bun and Deno.
//
// A project is a directory in /var/www/ with a systemd unit of the same name. The managing instance is
// the project named like the socket's group; it can see itself, but not stop, restart or delete itself.

import { execFile } from "node:child_process";
import { chmod, chown, cp, mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { availableParallelism, loadavg } from "node:os";
import process from "node:process";
import { promisify } from "node:util";

const run = promisify(execFile);

/** Where projects, their units, Caddy sites, templates and archived projects are; `self` is the managing project;
 *  `preview` a domain under which every project is reachable too, as `<domain>.<preview>` (empty: none). */
type Host = { www: string; units: string; caddy: string; templates: string; archive: string; self: string; preview: string };
type Args = Record<string, unknown>;

const PROPS = ["Id", "ActiveState", "SubState", "MemoryCurrent", "CPUUsageNSec", "TasksCurrent", "NRestarts", "ActiveEnterTimestamp", "ExecStart"];
/** A project name is its main domain (or, for older ones, any hostname-like name). */
const NAME = /^(?=.{1,100}$)[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/;
const PORTS: [number, number] = [8090, 8999];

/** Number or null for systemd's "[not set]" and its max-uint64 "infinity". */
const num = (v = "") => /^\d+$/.test(v) && v !== "18446744073709551615" ? Number(v) : null;
const exists = (path: string) => stat(path).then(() => true, () => false);

/** The program a unit starts (`bun`, `deno` …), from systemctl's `ExecStart={ path=/usr/local/bin/bun ; … }`. */
export const program = (exec = "") => exec.match(/path=\S*?([^/\s;]+) ;/)?.[1] ?? null;

/** Blocks of `key=value` lines, as printed by `systemctl show a b …`. */
export const parseShow = (text: string): Record<string, string>[] =>
  text.trim().split(/\n\n+/).map((block) => Object.fromEntries(block.split("\n").map((l) => {
    const i = l.indexOf("=");
    return [l.slice(0, i), l.slice(i + 1)];
  })));

/** Site blocks of a Caddyfile: their addresses and the ports they proxy to. Snippets and global options are skipped. */
export function parseCaddy(text: string): { domains: string[]; ports: number[] }[] {
  const sites = [];
  let depth = 0, site;
  for (const raw of text.split("\n")) {
    const line = raw.replace(/(^|\s)#.*/, "").trim();
    if (!line) continue;
    if (!depth && line.endsWith("{")) {
      const domains = line.slice(0, -1).split(/[\s,]+/).filter(Boolean);
      site = domains.length && !line.startsWith("(") ? { domains, ports: [] as number[] } : undefined;
      if (site) sites.push(site);
    }
    if (site && /^reverse_proxy\s/.test(line))
      for (const to of line.split(/\s+/).slice(1)) if (/:\d+$/.test(to)) site.ports.push(Number(to.split(":").pop()));
    depth += (line.match(/{/g)?.length ?? 0) - (line.match(/}/g)?.length ?? 0);
  }
  return sites;
}

/** Listening TCP sockets by unit, from `ss -lntpH` and the cgroup of each process. */
export async function parseSs(text: string, unitOf: (pid: number) => Promise<string | undefined>) {
  const listen = new Map<string, string[]>();
  for (const line of text.trim().split("\n")) {
    const [, , , local = "", , users = ""] = line.split(/\s+/);
    const pid = Number(users.match(/pid=(\d+)/)?.[1]);
    const unit = pid ? await unitOf(pid) : undefined;
    if (unit && !listen.get(unit)?.includes(local)) listen.set(unit, [...listen.get(unit) ?? [], local]);
  }
  return listen;
}

/** `{{key}}` replaced by its value; unknown keys stay. */
export const fill = (text: string, vars: Record<string, string>): string =>
  text.replace(/\{\{(\w+)\}\}/g, (all, key) => vars[key] ?? all);

/** The addresses of a new project: its domain, and its preview address unless it is under the preview's parent already. */
export function addresses(domain: string, preview: string): string[] {
  const parent = preview.split(".").slice(1).join(".");
  return preview && !domain.endsWith(`.${parent}`) ? [domain, `${domain}.${preview}`] : [domain];
}

/** The lowest port in range that nothing uses. */
export function freePort(used: Set<number>, [from, to] = PORTS): number {
  for (let port = from; port <= to; port++) if (!used.has(port)) return port;
  throw new Error("no free port");
}

/** From `/proc/meminfo`: total and available bytes. */
export function parseMeminfo(text: string): { total: number; available: number } {
  const kb = (key: string) => Number(text.match(new RegExp(`^${key}:\\s+(\\d+)`, "m"))?.[1] ?? 0) * 1024;
  return { total: kb("MemTotal"), available: kb("MemAvailable") };
}

const unitOf = async (pid: number) =>
  (await readFile(`/proc/${pid}/cgroup`, "utf8").catch(() => "")).match(/\/([^/]+\.service)$/m)?.[1];

async function names({ www, units: dir }: Host) {
  const units = new Set(await readdir(dir));
  const dirs = await readdir(www, { withFileTypes: true });
  return dirs.filter((d) => d.isDirectory() && units.has(`${d.name}.service`)).map((d) => d.name).sort();
}

async function show(units: string[]) {
  if (!units.length) return new Map<string, Record<string, string>>();
  const { stdout } = await run("systemctl", ["show", "--timestamp=unix", "-p", PROPS.join(","), ...units]);
  return new Map(parseShow(stdout).map((p) => [p.Id, p]));
}

async function caddy(dir: string) {
  const files = (await readdir(dir).catch(() => [])).filter((f) => f.endsWith(".caddy"));
  const texts = await Promise.all(files.map((f) => readFile(dir + f, "utf8")));
  return texts.flatMap(parseCaddy);
}

async function disk(dir: string) {
  const { stdout } = await run("du", ["-sb", dir]).catch(() => ({ stdout: "" }));
  return num(stdout.split("\t")[0]);
}

async function templates(dir: string) {
  return (await readdir(dir, { withFileTypes: true }).catch(() => [])).filter((d) => d.isDirectory()).map((d) => d.name).sort();
}

/** Memory, the disk the projects are on, CPUs and load, and the templates new projects can start from. */
async function server(host: Host) {
  const { stdout } = await run("df", ["-B1", "--output=size,avail", host.www]);
  const [total = 0, available = 0] = stdout.trim().split("\n").pop()!.trim().split(/\s+/).map(Number);
  return {
    memory: parseMeminfo(await readFile("/proc/meminfo", "utf8")),
    disk: { total, available },
    cpus: availableParallelism(),
    load: loadavg(),
    self: host.self,
    preview: host.preview,
    templates: await templates(host.templates),
  };
}

/** Every project with state, resources, listening sockets and domains, and the server. CPU is measured over one second. */
async function list(host: Host) {
  const all = await names(host);
  const units = all.map((n) => `${n}.service`);
  const [before, sites, ss] = await Promise.all([show(units), caddy(host.caddy), run("ss", ["-lntpH"])]);
  const listen = await parseSs(ss.stdout, unitOf);
  await new Promise((r) => setTimeout(r, 1000));
  const after = await show(units);
  const projects = await Promise.all(all.map(async (name) => {
    const unit = `${name}.service`, p = after.get(unit) ?? {};
    const cpu = (num(p.CPUUsageNSec) ?? NaN) - (num(before.get(unit)?.CPUUsageNSec) ?? NaN);
    const sockets = listen.get(unit) ?? [];
    const ports = sockets.map((s) => Number(s.split(":").pop()));
    return {
      name,
      program: program(p.ExecStart),
      state: p.ActiveState,
      sub: p.SubState,
      since: num(p.ActiveEnterTimestamp?.slice(1)),
      restarts: num(p.NRestarts),
      memory: num(p.MemoryCurrent),
      cpu: Number.isNaN(cpu) ? null : Math.round(cpu / 1e7), // percent of one core
      tasks: num(p.TasksCurrent),
      disk: await disk(host.www + name),
      listen: sockets,
      domains: sites.filter((s) => s.ports.some((port) => ports.includes(port))).flatMap((s) => s.domains),
    };
  }));
  return { server: await server(host), projects };
}

export type List = Awaited<ReturnType<typeof list>>;
export type Project = List["projects"][number];

/** A known project's name; `act`: one that may be acted on, so not the managing instance itself. */
async function project(host: Host, args: Args, act = true) {
  const name = String(args.name ?? "");
  if (!(await names(host)).includes(name)) throw new Error(`unknown project "${name}"`);
  if (act && name === host.self) throw new Error("the managing instance does not act on itself");
  return name;
}

const unit = (verb: "start" | "stop" | "restart") => async (host: Host, args: Args) => {
  await run("systemctl", [verb, `${await project(host, args)}.service`]);
};

/** The last lines of a project's journal, the managing instance's own too. */
async function log(host: Host, args: Args) {
  const name = await project(host, args, false);
  const { stdout } = await run("journalctl", ["-u", `${name}.service`, "-n", "200", "--no-pager", "-o", "short-iso"]);
  return stdout;
}

/** Steps that can be taken back: on failure the done ones are undone, last first. */
async function steps(fn: (undo: (f: () => Promise<unknown>) => void) => Promise<void>) {
  const undos: (() => Promise<unknown>)[] = [];
  try {
    await fn((f) => undos.push(f));
  } catch (e) {
    for (const f of undos.reverse()) await f().catch((err) => console.error("undo failed:", err));
    throw e;
  }
}

/** For files others read (systemd, Caddy): the helper's umask keeps them from the world otherwise. */
async function publish(path: string, text: string) {
  await writeFile(path, text);
  await chown(path, 0, 0); // not the helper's group
  await chmod(path, 0o644);
}

/** Copy `from` into `to`, `{{…}}` filled in every file. */
async function copy(from: string, to: string, vars: Record<string, string>) {
  for (const entry of await readdir(from, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      await mkdir(to + entry.name, { recursive: true });
      await copy(`${from}${entry.name}/`, `${to}${entry.name}/`, vars);
    } else {
      await writeFile(to + entry.name, fill(await readFile(from + entry.name, "utf8"), vars));
    }
  }
}

/** Ports in use: proxied by Caddy, set in a unit, or listening. */
async function usedPorts(host: Host, sites: { ports: number[] }[]) {
  const units = (await readdir(host.units)).filter((u) => u.endsWith(".service"));
  const fromUnits = await Promise.all(units.map(async (u) =>
    Number((await readFile(host.units + u, "utf8")).match(/^Environment=PORT=(\d+)/m)?.[1] ?? 0)));
  const listening = (await run("ss", ["-lntH"])).stdout.split("\n").map((l) => Number(l.split(/\s+/)[3]?.split(":").pop()));
  return new Set([...sites.flatMap((s) => s.ports), ...fromUnits, ...listening]);
}

/** A new project from a template: user, directory, the template's files, its install.sh (run as the
 *  user), unit and Caddy site, then started. A template is a directory with `files/`, `unit.service`,
 *  `site.caddy` and optionally `install.sh`; `{{name}}`, `{{domain}}`, `{{addresses}}` (the domain and its
 *  preview address), `{{port}}` and `{{root}}` are filled in. Anything that fails takes the done steps back. */
async function create(host: Host, args: Args) {
  const name = String(args.domain ?? "").toLowerCase(), template = String(args.template ?? "");
  if (!NAME.test(name) || !name.includes(".")) throw new Error(`invalid domain "${name}"`);
  if (!(await templates(host.templates)).includes(template)) throw new Error(`unknown template "${template}"`);
  const root = `${host.www}${name}/`, tpl = `${host.templates}${template}/`;
  const unitFile = `${host.units}${name}.service`, site = `${host.caddy}${name}.caddy`;
  for (const path of [root, unitFile, site]) if (await exists(path)) throw new Error(`${path} exists already`);
  if (await run("id", ["-u", name]).then(() => true, () => false)) throw new Error(`user "${name}" exists already`);
  const sites = await caddy(host.caddy), served = addresses(name, host.preview);
  for (const a of served) if (sites.some((s) => s.domains.includes(a))) throw new Error(`${a} is served already`);
  const port = freePort(await usedPorts(host, sites));
  const vars = { name, domain: name, addresses: served.join(", "), port: String(port), root };
  const env = Object.fromEntries(Object.entries(vars).map(([k, v]) => [k.toUpperCase(), v]));

  await steps(async (undo) => {
    await run("useradd", ["-r", "-M", "-d", root, "-s", "/usr/sbin/nologin", name]);
    undo(() => run("userdel", [name]));
    await mkdir(root, { mode: 0o750 });
    undo(() => rm(root, { recursive: true, force: true }));
    await copy(`${tpl}files/`, root, vars);
    await run("chown", ["-R", `${name}:`, root]);
    await chmod(root, 0o750);
    if (await exists(`${tpl}install.sh`)) {
      await run("runuser", ["-u", name, "--", "/bin/sh", `${tpl}install.sh`], {
        cwd: root, env: { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: root, ...env }, timeout: 5 * 60_000,
      });
    }
    await publish(unitFile, fill(await readFile(`${tpl}unit.service`, "utf8"), vars));
    undo(() => rm(unitFile, { force: true }).then(() => run("systemctl", ["daemon-reload"])));
    await run("systemctl", ["daemon-reload"]);
    await run("systemctl", ["enable", "--now", `${name}.service`]);
    undo(() => run("systemctl", ["disable", "--now", `${name}.service`]));
    await publish(site, fill(await readFile(`${tpl}site.caddy`, "utf8"), vars));
    undo(() => rm(site, { force: true }).then(() => run("systemctl", ["reload", "caddy"])));
    await run("caddy", ["validate", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"]);
    await run("systemctl", ["reload", "caddy"]);
  });
  return { name, port, addresses: served };
}

/** Moves `from` to `to`, across filesystems too. */
const move = (from: string, to: string) =>
  rename(from, to).catch((e) => e.code === "EXDEV"
    ? cp(from, to, { recursive: true }).then(() => rm(from, { recursive: true }))
    : Promise.reject(e));

/** Stops the project and moves its directory, unit and Caddy site into the archive; the user goes.
 *  Domains of it in other Caddy files stay and are returned. */
async function remove(host: Host, args: Args) {
  const name = await project(host, args);
  const to = `${host.archive}${name}-${new Date().toISOString().slice(0, 19).replace(/\D/g, "")}/`;
  await mkdir(host.archive, { recursive: true, mode: 0o700 });
  await mkdir(to, { mode: 0o700 });
  await run("systemctl", ["disable", "--now", `${name}.service`]);
  await move(`${host.units}${name}.service`, `${to}${name}.service`);
  await run("systemctl", ["daemon-reload"]);
  if (await exists(`${host.caddy}${name}.caddy`)) {
    await move(`${host.caddy}${name}.caddy`, `${to}${name}.caddy`);
    await run("systemctl", ["reload", "caddy"]);
  }
  await move(`${host.www}${name}`, `${to}www`);
  await run("userdel", [name]).catch(() => {});
  const stillServed = (await caddy(host.caddy)).filter((s) => s.domains.includes(name)).flatMap((s) => s.domains);
  return { archive: to, stillServed };
}

const verbs: Record<string, (host: Host, args: Args) => Promise<unknown>> = {
  list, log, start: unit("start"), stop: unit("stop"), restart: unit("restart"), create, delete: remove,
};
/** Verbs that change something run one after the other: two creates must not pick the same port. */
const READ = new Set(["list", "log"]);
let queue: Promise<unknown> = Promise.resolve();

async function answer(line: string, host: Host) {
  try {
    const { verb, ...args } = JSON.parse(line);
    if (!Object.hasOwn(verbs, verb)) throw new Error(`unknown verb "${verb}"`);
    console.log(verb, args.name ?? args.domain ?? "");
    const job = READ.has(verb) ? verbs[verb](host, args) : (queue = queue.catch(() => {}).then(() => verbs[verb](host, args)));
    return { ok: true, data: await job };
  } catch (e) {
    const err = e as { message?: string; stderr?: string };
    return { ok: false, error: String(err.stderr || err.message || e).trim() };
  }
}

/** One request per connection: a JSON line in, a JSON line out. */
export async function serve(path: string, host: Host): Promise<void> {
  const server = createServer((sock) => {
    let buf = "";
    sock.setTimeout(10 * 60_000, () => sock.destroy()); // a create clones and installs
    sock.on("error", () => {});
    sock.on("data", async (chunk) => {
      buf += chunk;
      if (buf.length > 65536) return sock.destroy();
      const nl = buf.indexOf("\n");
      if (nl < 0) return;
      sock.removeAllListeners("data");
      sock.end(JSON.stringify(await answer(buf.slice(0, nl), host)) + "\n");
    });
  });
  await rm(path, { force: true });
  // the socket's group is the service's Group=, the managing instance
  server.listen(path, () => chmod(path, 0o660));
}

if (import.meta.main) {
  const env = process.env;
  await serve(env.HOSTING_SOCKET ?? "/run/qino-hosting/hosting.sock", {
    www: env.HOSTING_WWW ?? "/var/www/",
    units: env.HOSTING_UNITS ?? "/etc/systemd/system/",
    caddy: env.HOSTING_CADDY ?? "/etc/caddy/sites/",
    templates: env.HOSTING_TEMPLATES ?? new URL("templates/", import.meta.url).pathname,
    archive: env.HOSTING_ARCHIVE ?? "/var/backups/qino-hosting/",
    self: (await run("id", ["-gn"])).stdout.trim(),
    preview: env.HOSTING_PREVIEW ?? "",
  });
}
