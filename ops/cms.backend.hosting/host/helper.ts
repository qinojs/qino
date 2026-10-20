// The root side of cms.backend.hosting: answers a fixed set of verbs on a unix socket.
// No dependencies but the runtime, so nothing else runs as root. Runs on Node, Bun and Deno.
//
// A project is a directory in /var/www/ with a systemd unit of the same name.

import { execFile } from "node:child_process";
import { chmod, readdir, readFile, rm } from "node:fs/promises";
import { createServer } from "node:net";
import process from "node:process";
import { promisify } from "node:util";

const run = promisify(execFile);

/** Where projects, their units and their Caddy sites are. */
type Paths = { www: string; units: string; caddy: string };

const PROPS = ["Id", "ActiveState", "SubState", "MemoryCurrent", "CPUUsageNSec", "TasksCurrent", "NRestarts", "ActiveEnterTimestamp"];

/** Number or null for systemd's "[not set]" and its max-uint64 "infinity". */
const num = (v = "") => /^\d+$/.test(v) && v !== "18446744073709551615" ? Number(v) : null;

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

const unitOf = async (pid: number) =>
  (await readFile(`/proc/${pid}/cgroup`, "utf8").catch(() => "")).match(/\/([^/]+\.service)$/m)?.[1];

async function names({ www, units: dir }: Paths) {
  const units = new Set(await readdir(dir));
  const dirs = await readdir(www, { withFileTypes: true });
  return dirs.filter((d) => d.isDirectory() && units.has(`${d.name}.service`)).map((d) => d.name).sort();
}

async function show(units: string[]) {
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

/** Every project with state, resources, listening sockets and domains. CPU is measured over one second. */
async function list(paths: Paths) {
  const all = await names(paths);
  const units = all.map((n) => `${n}.service`);
  const [before, sites, ss] = await Promise.all([show(units), caddy(paths.caddy), run("ss", ["-lntpH"])]);
  const listen = await parseSs(ss.stdout, unitOf);
  await new Promise((r) => setTimeout(r, 1000));
  const after = await show(units);
  return Promise.all(all.map(async (name) => {
    const unit = `${name}.service`, p = after.get(unit) ?? {};
    const cpu = (num(p.CPUUsageNSec) ?? NaN) - (num(before.get(unit)?.CPUUsageNSec) ?? NaN);
    const sockets = listen.get(unit) ?? [];
    const ports = sockets.map((s) => Number(s.split(":").pop()));
    return {
      name,
      state: p.ActiveState,
      sub: p.SubState,
      since: num(p.ActiveEnterTimestamp?.slice(1)),
      restarts: num(p.NRestarts),
      memory: num(p.MemoryCurrent),
      cpu: Number.isNaN(cpu) ? null : Math.round(cpu / 1e7), // percent of one core
      tasks: num(p.TasksCurrent),
      disk: await disk(paths.www + name),
      listen: sockets,
      domains: sites.filter((s) => s.ports.some((port) => ports.includes(port))).flatMap((s) => s.domains),
    };
  }));
}

export type Project = Awaited<ReturnType<typeof list>>[number];

const verbs: Record<string, (paths: Paths) => Promise<unknown>> = { list };

async function answer(line: string, paths: Paths) {
  try {
    const { verb } = JSON.parse(line);
    if (!Object.hasOwn(verbs, verb)) throw new Error(`unknown verb "${verb}"`);
    console.log(verb);
    return { ok: true, data: await verbs[verb](paths) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** One request per connection: a JSON line in, a JSON line out. */
export async function serve(path: string, paths: Paths): Promise<void> {
  const server = createServer((sock) => {
    let buf = "";
    sock.setTimeout(60_000, () => sock.destroy());
    sock.on("error", () => {});
    sock.on("data", async (chunk) => {
      buf += chunk;
      if (buf.length > 65536) return sock.destroy();
      const nl = buf.indexOf("\n");
      if (nl < 0) return;
      sock.removeAllListeners("data");
      sock.end(JSON.stringify(await answer(buf.slice(0, nl), paths)) + "\n");
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
  });
}
