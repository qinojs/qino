import { getQuickJS } from "quickjs-emscripten";

import { capabilities, decode, encode, pack, unpack } from "./engine.ts";

import type { QuickJSContext, QuickJSHandle, QuickJSRuntime, QuickJSWASMModule } from "quickjs-emscripten";
import type { Engine, EngineFactory } from "./engine.ts";

/** Memory a sandbox may use, in bytes. */
const MEMORY = 64 * 2 ** 20;

type Box = {
  runtime: QuickJSRuntime;
  vm: QuickJSContext;
  run: QuickJSHandle;
  held: Set<{ alive: boolean; dispose(): void }>; // handles to free on close, or the runtime aborts
  timers: Set<ReturnType<typeof setTimeout>>; // behind setTimeout in the sandbox
};

// The WASM module is compiled once per process; a runtime in it is cheap.
let loaded: Promise<QuickJSWASMModule> | undefined;

/** Runs inside QuickJS: capabilities call out through `host`, timers wait through `sleep`; returns the
 *  function that runs code. Values cross as JSON, both ways. */
function boot(keys: string[], host: (call: string) => Promise<string>, sleep: (ms: number) => Promise<void>) {
  const g = globalThis as any, timers = new Set<number>();
  let seq = 0;
  g.setTimeout = (fn: (...a: unknown[]) => void, ms = 0, ...args: unknown[]) => {
    const id = ++seq;
    timers.add(id);
    sleep(Number(ms) || 0).then(() => timers.delete(id) && fn(...args));
    return id;
  };
  g.clearTimeout = (id: number) => void timers.delete(id);
  const caps = capabilities(keys, async (key, args) => {
    const reply = decode(await host(encode([key, args]))); // JSON keeps the "\0" in the key
    if (reply.error) throw unpack(reply.error);
    return reply.value;
  });
  return async (source: string, json: string) => {
    try {
      return encode({ value: await (0, eval)(`(${source})`)(decode(json).input, caps) });
    } catch (e) {
      return encode({ error: pack(e) });
    }
  };
}

/** A JavaScript engine of its own, compiled to WASM: the code reaches nothing of the host — no files,
 *  no network, no env — but timers, and has its own memory, capped. Values cross as JSON (keeping
 *  `undefined`). Runs in Deno, Node and Bun alike. */
export const quickjs: EngineFactory = ({ keys, call, timeout }) => new QuickJsEngine(keys, call, timeout);

class QuickJsEngine implements Engine {
  #keys: string[];
  #call: (key: string, args: unknown[]) => Promise<unknown>;
  #timeout: number;
  #box?: Promise<Box>;
  #runs = new Set<(e: Error) => void>();
  #deadline = 0;
  #interrupted = false;

  constructor(keys: string[], call: (key: string, args: unknown[]) => Promise<unknown>, timeout: number) {
    this.#keys = keys;
    this.#call = call;
    this.#timeout = timeout;
  }

  async run(source: string, input: unknown): Promise<unknown> {
    const started = this.#box ??= this.#start();
    const box = await started;
    if (started !== this.#box) throw new Error("Sandbox: closed"); // closed while starting
    const json = encode({ input });
    return new Promise((resolve, reject) => {
      const done = (fn: () => void) => (this.#runs.delete(reject), fn());
      this.#runs.add(reject);
      const { vm } = box;
      const args = [vm.newString(source), vm.newString(json)];
      const result = this.#step(() => vm.callFunction(box.run, vm.undefined, ...args));
      for (const h of args) h.dispose();
      if (!this.#runs.has(reject)) return result.dispose(); // interrupted: closed, and already failed
      if (result.error) {
        const error = vm.dump(result.error);
        result.error.dispose();
        return done(() => reject(unpack(error)));
      }
      const promise = result.value;
      box.held.add(promise);
      vm.resolvePromise(promise).then((settled) => {
        if (!promise.alive) return; // closed meanwhile
        box.held.delete(promise);
        promise.dispose();
        if (settled.error) {
          const error = vm.dump(settled.error);
          settled.error.dispose();
          return done(() => reject(unpack(error)));
        }
        const reply = decode(vm.getString(settled.value));
        settled.value.dispose();
        done(() => reply.error ? reject(unpack(reply.error)) : resolve(reply.value));
      });
      this.#pump(box);
    });
  }

  close(error: Error): void {
    const box = this.#box;
    this.#box = undefined;
    for (const reject of this.#runs) reject(error);
    this.#runs.clear();
    box?.then((b) => {
      for (const timer of b.timers) clearTimeout(timer);
      for (const h of b.held) if (h.alive) h.dispose();
      b.run.dispose();
      b.vm.dispose();
      b.runtime.dispose();
    });
  }

  async #start(): Promise<Box> {
    const runtime = (await (loaded ??= getQuickJS())).newRuntime();
    runtime.setMemoryLimit(MEMORY);
    runtime.setInterruptHandler(() => Date.now() > this.#deadline && (this.#interrupted = true));
    this.#deadline = Date.now() + this.#timeout; // setting up is a stretch of code too
    const vm = runtime.newContext();
    const box = { runtime, vm, held: new Set(), timers: new Set() } as unknown as Box;
    const host = vm.newFunction("host", (callHandle) => {
      const [key, args] = decode(vm.getString(callHandle));
      const deferred = vm.newPromise();
      box.held.add(deferred);
      this.#call(key, args).then((value) => ({ value }), (e) => ({ error: pack(e) })).then((reply) => {
        if (!deferred.alive) return; // closed meanwhile
        let json;
        try {
          json = encode(reply);
        } catch (e) { // a result JSON can't carry (a cycle, a BigInt …)
          json = encode({ error: pack(e) });
        }
        const value = vm.newString(json);
        deferred.resolve(value);
        value.dispose();
        deferred.dispose();
        box.held.delete(deferred);
        this.#pump(box);
      });
      return deferred.handle.dup(); // the engine owns what is returned; the deferred keeps its own
    });
    const sleep = vm.newFunction("sleep", (msHandle) => {
      const deferred = vm.newPromise();
      box.held.add(deferred);
      const timer = setTimeout(() => {
        box.timers.delete(timer);
        if (!deferred.alive) return;
        deferred.resolve();
        deferred.dispose();
        box.held.delete(deferred);
        this.#pump(box);
      }, vm.getNumber(msHandle));
      box.timers.add(timer);
      return deferred.handle.dup();
    });
    const make = vm.unwrapResult(vm.evalCode(`(() => {
      const pack = ${pack}, unpack = ${unpack}, encode = ${encode}, decode = ${decode};
      ${capabilities}
      return ${boot}; })()`));
    const keys = vm.newString(JSON.stringify(this.#keys));
    const parsed = vm.unwrapResult(vm.evalCode("JSON.parse"));
    const keyList = vm.unwrapResult(vm.callFunction(parsed, vm.undefined, keys));
    box.run = vm.unwrapResult(vm.callFunction(make, vm.undefined, keyList, host, sleep));
    for (const h of [make, keys, parsed, keyList, host, sleep]) h.dispose();
    return box;
  }

  /** Runs one stretch of code in the engine. Code that never gives control back is interrupted and ends
   *  the sandbox — once interrupted, nothing in it runs on. */
  #step<T>(fn: () => T): T {
    this.#deadline = Date.now() + this.#timeout;
    const result = fn();
    if (this.#interrupted) this.#late();
    return result;
  }

  /** Lets the engine go on with what waited on a settled promise — in batches, so code that keeps
   *  queueing more can't hold the host past the timeout. */
  #pump(box: Box) {
    this.#deadline = Date.now() + this.#timeout;
    while (this.#box && box.runtime.alive && box.runtime.hasPendingJob()) {
      box.runtime.executePendingJobs(100).error?.dispose();
      if (this.#interrupted || Date.now() > this.#deadline) return this.#late();
    }
  }

  #late() {
    this.#interrupted = false;
    if (this.#box) this.close(new Error(`Sandbox: no result after ${this.#timeout} ms`));
  }
}
