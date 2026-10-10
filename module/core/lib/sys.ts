import { spawn } from "node:child_process";
import { Resolver } from "node:dns/promises";
import { loadavg, uptime } from "node:os";
import { pathToFileURL } from "node:url";

// deno-lint-ignore no-explicit-any
const { Bun, Deno, process } = globalThis as any;

type CommandOptions = {
  args?: string[];
  cwd?: string;
  /** Added to the inherited environment. */
  env?: Record<string, string>;
  /** Aborting ends the process with SIGTERM; the result then has code 143. */
  signal?: AbortSignal;
  stdout?: "piped" | "null";
  stderr?: "piped" | "null";
};
type CommandOutput = { code: number; success: boolean; signal: string | null; stdout: Uint8Array; stderr: Uint8Array };
type RecordType = "A" | "AAAA" | "CNAME" | "NS" | "PTR";

const SIGNALS: Record<string, number> = { SIGHUP: 1, SIGINT: 2, SIGKILL: 9, SIGTERM: 15 };

/** Runs a command to its end, the Node way (Bun too). */
function nodeCommand(cmd: string, { args = [], cwd, env, signal, stdout = "piped", stderr = "piped" }: CommandOptions) {
  return new Promise<CommandOutput>((resolve, reject) => {
    const io = (mode: string) => mode === "null" ? "ignore" : "pipe";
    const proc = spawn(cmd, args, {
      cwd,
      env: env && { ...process.env, ...env },
      signal,
      stdio: ["ignore", io(stdout), io(stderr)],
    });
    const out: Uint8Array[] = [], err: Uint8Array[] = [];
    proc.stdout?.on("data", (d: Uint8Array) => out.push(d));
    proc.stderr?.on("data", (d: Uint8Array) => err.push(d));
    proc.on("error", (e: Error) => e.name === "AbortError" || reject(e)); // aborted: "close" follows, as in Deno
    proc.on("close", (code: number | null, sig: string | null) => {
      code ??= 128 + (SIGNALS[sig!] ?? 0);
      resolve({ code, success: code === 0, signal: sig, stdout: concat(out), stderr: concat(err) });
    });
  });
}

const concat = (parts: Uint8Array[]) => {
  const all = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) all.set(p, at), at += p.length;
  return all;
};

/** What depends on the JS runtime (processes, system info, DNS), for Deno, Bun and Node; files are in
 *  `fs`. Another runtime is added here, not at the callers. Names follow Deno. */
export const sys = {
  /** Name and version, e.g. "Deno 2.9.5". */
  runtime: Deno ? `Deno ${Deno.version.deno}` : Bun ? `Bun ${Bun.version}` : `Node ${process.versions.node}`,
  /** "linux", "darwin", "windows" … */
  os: (Deno ? Deno.build.os : process.platform === "win32" ? "windows" : process.platform) as string,
  pid: (Deno ?? process).pid as number,
  /** URL of the entry module. */
  mainModule: (Deno ? Deno.mainModule : pathToFileURL(Bun ? Bun.main : process.argv[1]).href) as string,

  /** Like `new Deno.Command(cmd, opt).output()`, but a missing binary rejects instead of throwing. */
  async command(cmd: string, opt: CommandOptions = {}): Promise<CommandOutput> {
    if (Deno) return await new Deno.Command(cmd, opt).output();
    return nodeCommand(cmd, opt);
  },
  /** Undefined if not set. Throws in Deno without `--allow-env`. */
  env(name: string): string | undefined {
    return Deno ? Deno.env.get(name) : process.env[name];
  },
  exit(code?: number): never {
    return (Deno ?? process).exit(code) as never;
  },
  /** Null where there is none (Windows). Throws in Deno without `--allow-sys`. */
  uid(): number | null {
    return Deno ? Deno.uid() : process.getuid?.() ?? null;
  },
  memoryUsage(): { rss: number; heapTotal: number; heapUsed: number; external: number } {
    return (Deno ?? process).memoryUsage();
  },
  /** Throws in Deno without `--allow-sys`. */
  loadavg(): number[] {
    return Deno ? Deno.loadavg() : loadavg();
  },
  /** Seconds since boot. Throws in Deno without `--allow-sys`. */
  osUptime(): number {
    return Deno ? Deno.osUptime() : uptime();
  },
  /** The timer no longer keeps the process alive. */
  unrefTimer(timer: ReturnType<typeof setTimeout>): void {
    // deno-lint-ignore no-explicit-any
    Deno ? Deno.unrefTimer(timer) : (timer as any).unref?.();
  },
  /** Records that are plain names or addresses. */
  resolveDns(name: string, type: RecordType, { signal }: { signal?: AbortSignal } = {}): Promise<string[]> {
    if (Deno) return Deno.resolveDns(name, type, { signal });
    if (signal?.aborted) return Promise.reject(signal.reason);
    const resolver = new Resolver();
    const cancel = () => resolver.cancel();
    signal?.addEventListener("abort", cancel, { once: true });
    return resolver.resolve(name, type).finally(() => signal?.removeEventListener("abort", cancel)) as Promise<string[]>;
  },
};
