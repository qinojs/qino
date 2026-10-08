// deno-lint-ignore-file no-explicit-any
import { dirname, join } from "node:path";

type Fn = (...args: any[]) => unknown;
type Capabilities = { [name: string]: Fn | Capabilities };
type Run = {
  resolve: (value: any) => void;
  reject: (e: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

// Errors cross as plain data, both ways; the worker gets these as source, like boot().
const pack = (e: any) => ({ name: e?.name, message: e?.message ?? String(e), code: e?.code, data: e?.data });
const unpack = (e: { message: string }) => Object.assign(new Error(e.message), e);

/** Runs inside the worker: builds the capabilities as functions that call back, runs what it is sent. */
function boot(keys: string[]) {
  const g = globalThis as any, pending = new Map(), caps: any = {};
  let seq = 0;
  for (const key of keys) {
    const path = key.split("\0");
    let o = caps;
    for (const k of path.slice(0, -1)) o = o[k] ??= {};
    o[path.at(-1)!] = (...args: unknown[]) => new Promise((resolve, reject) => {
      pending.set(++seq, { resolve, reject });
      g.postMessage({ call: seq, key, args });
    });
  }
  g.onmessage = async ({ data }: MessageEvent) => {
    if (data.reply) {
      const p = pending.get(data.reply);
      pending.delete(data.reply);
      return data.error ? p.reject(unpack(data.error)) : p.resolve(data.value);
    }
    try {
      g.postMessage({ done: data.run, value: await (0, eval)(`(${data.source})`)(data.input, caps) });
    } catch (e) {
      g.postMessage({ done: data.run, error: pack(e) });
    }
  };
}

/** Runs code in a Worker without any permissions: no files, no network, no env. It sees only the
 *  `capabilities` passed in; their calls come back here. A timeout ends the worker and every run in it. */
export class Sandbox {
  #fns = new Map<string, Fn>(); // capability path, joined by "\0"
  #timeout: number;
  #worker?: Worker;
  #runs = new Map<number, Run>();
  #seq = 0;

  constructor(
    { capabilities = {}, timeout = 30_000 }: { capabilities?: Capabilities; timeout?: number } = {},
  ) {
    this.#timeout = timeout;
    const walk = (o: Capabilities, path: string[]) => {
      for (const [k, v] of Object.entries(o)) {
        typeof v === "function" ? this.#fns.set([...path, k].join("\0"), v) : walk(v, [...path, k]);
      }
    };
    walk(capabilities, []);
  }

  /** Runs `source` (a function or its source) as `fn(input, capabilities)`; resolves with its result. */
  run<T = unknown>(source: string | Fn, input?: unknown): Promise<T> {
    const worker = this.#worker ??= this.#start();
    const id = ++this.#seq;
    return new Promise((resolve, reject) => {
      const late = () => this.#end(new Error(`Sandbox: no result after ${this.#timeout} ms`));
      const timer = setTimeout(late, this.#timeout);
      this.#runs.set(id, { resolve, reject, timer });
      worker.postMessage({ run: id, source: String(source), input });
    });
  }

  /** Ends the worker; running runs fail. The next run starts a new one. */
  close(): void {
    this.#end(new Error("Sandbox: closed"));
  }

  [Symbol.dispose](): void {
    this.close();
  }

  #start(): Worker {
    // without the flag Deno exits the whole process instead of throwing, so ask first
    if (!restrictable()) {
      const how = `--unstable-worker-options, or "unstable": ["worker-options"] in deno.json`;
      throw new Error(`Sandbox needs Deno's worker-options: ${how}`);
    }
    const keys = JSON.stringify([...this.#fns.keys()]);
    const source = `const pack = ${pack}, unpack = ${unpack}; (${boot})(${keys});`;
    const options = { type: "module", deno: { permissions: "none" } } as WorkerOptions;
    const worker = new Worker("data:text/javascript," + encodeURIComponent(source), options);
    worker.onmessage = ({ data }) => data.call ? this.#call(worker, data) : this.#done(data);
    worker.onerror = (e) => (e.preventDefault(), this.#end(new Error(`Sandbox: ${e.message}`)));
    return worker;
  }

  async #call(worker: Worker, { call, key, args }: { call: number; key: string; args: unknown[] }) {
    let reply;
    try {
      reply = { reply: call, value: await this.#fns.get(key)!(...args) };
    } catch (e) {
      reply = { reply: call, error: pack(e) };
    }
    if (worker !== this.#worker) return; // ended meanwhile
    try {
      worker.postMessage(reply);
    } catch (e) { // a result that can't be copied (a function, a class instance with private state …)
      worker.postMessage({ reply: call, error: pack(e) });
    }
  }

  #done({ done, value, error }: { done: number; value?: unknown; error?: { message: string } }) {
    const run = this.#runs.get(done);
    if (!run) return;
    this.#runs.delete(done);
    clearTimeout(run.timer);
    error ? run.reject(unpack(error)) : run.resolve(value);
  }

  #end(error: Error) {
    this.#worker?.terminate();
    this.#worker = undefined;
    for (const run of this.#runs.values()) clearTimeout(run.timer), run.reject(error);
    this.#runs.clear();
  }
}

let restricted: boolean | undefined;
const restrictable = () => restricted ??= decide();

/** Whether workers can be given their own permissions, decided as Deno does: the flag, else the config
 *  it uses — `--config <file>`, none with `--no-config`, else a deno.json from the working directory up
 *  (a workspace root counts too). */
function decide() {
  const flags = denoFlags();
  if (flags.includes("--unstable-worker-options")) return true;
  if (flags.includes("--no-config")) return false;
  const i = flags.findIndex((f) => f === "--config" || f === "-c");
  const file = i >= 0 ? flags[i + 1] : flags.find((f) => f.startsWith("--config="))?.slice(9);
  if (file) return unstable(file);
  for (let dir = Deno.cwd(); ; dir = dirname(dir)) {
    if (unstable(join(dir, "deno.json"))) return true;
    if (dirname(dir) === dir) return false;
  }
}

/** Deno's own flags: the command line without the script and its arguments (`Deno.args`). */
function denoFlags() {
  try {
    const all = Deno.readTextFileSync("/proc/self/cmdline").split("\0").filter(Boolean);
    return all.slice(0, all.length - Deno.args.length - 1);
  } catch {
    // Deno opens /proc/self only with --allow-all, and there is no /proc outside Linux: then the flags
    // are unknown and deno.json decides — wrong only if --no-config or --config point elsewhere
    return [];
  }
}

function unstable(file: string) {
  try {
    return !!JSON.parse(Deno.readTextFileSync(file)).unstable?.includes("worker-options");
  } catch {
    return false; // none there, or not plain JSON
  }
}
