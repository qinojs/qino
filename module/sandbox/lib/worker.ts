// deno-lint-ignore-file no-explicit-any
import { dirname, join } from "node:path";

import { capabilities, pack, unpack } from "./engine.ts";

import type { Engine, EngineFactory } from "./engine.ts";

type Run = { resolve: (value: any) => void; reject: (e: Error) => void };

/** Runs inside the worker: builds the capabilities as functions that call back, runs what it is sent. */
function boot(keys: string[]) {
  const g = globalThis as any, pending = new Map();
  let seq = 0;
  const caps = capabilities(keys, (key, args) => new Promise((resolve, reject) => {
    pending.set(++seq, { resolve, reject });
    g.postMessage({ call: seq, key, args });
  }));
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

/** A Deno Worker without any permissions: no files, no network, no env. Values cross by structured
 *  clone. Deno only, and only with `--unstable-worker-options`. */
export const worker: EngineFactory = ({ keys, call }) => new WorkerEngine(keys, call);

class WorkerEngine implements Engine {
  #keys: string[];
  #call: (key: string, args: unknown[]) => Promise<unknown>;
  #worker?: Worker;
  #runs = new Map<number, Run>();
  #seq = 0;

  constructor(keys: string[], call: (key: string, args: unknown[]) => Promise<unknown>) {
    this.#keys = keys;
    this.#call = call;
  }

  run(source: string, input: unknown): Promise<unknown> {
    const worker = this.#worker ??= this.#start();
    const id = ++this.#seq;
    return new Promise((resolve, reject) => {
      this.#runs.set(id, { resolve, reject });
      worker.postMessage({ run: id, source, input });
    });
  }

  close(error: Error): void {
    this.#worker?.terminate();
    this.#worker = undefined;
    for (const run of this.#runs.values()) run.reject(error);
    this.#runs.clear();
  }

  #start() {
    // without the flag Deno exits the whole process instead of throwing, so ask first
    if (!restrictable()) {
      const how = `--unstable-worker-options, or "unstable": ["worker-options"] in deno.json`;
      throw new Error(`Sandbox needs Deno's worker-options: ${how}`);
    }
    const keys = JSON.stringify(this.#keys);
    const source = `const pack = ${pack}, unpack = ${unpack}; ${capabilities} (${boot})(${keys});`;
    const options = { type: "module", deno: { permissions: "none" } } as WorkerOptions;
    const worker = new Worker("data:text/javascript," + encodeURIComponent(source), options);
    worker.onmessage = ({ data }) => data.call ? this.#reply(worker, data) : this.#done(data);
    worker.onerror = (e) => (e.preventDefault(), this.close(new Error(`Sandbox: ${e.message}`)));
    return worker;
  }

  async #reply(worker: Worker, { call, key, args }: { call: number; key: string; args: unknown[] }) {
    let reply;
    try {
      reply = { reply: call, value: await this.#call(key, args) };
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
    error ? run.reject(unpack(error)) : run.resolve(value);
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
