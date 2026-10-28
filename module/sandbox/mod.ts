// deno-lint-ignore-file no-explicit-any
import { quickjs } from "./lib/quickjs.ts";

import type { Engine, EngineFactory } from "./lib/engine.ts";

export { quickjs } from "./lib/quickjs.ts";
export { worker } from "./lib/worker.ts";

type Fn = (...args: any[]) => unknown;
type Capabilities = { [name: string]: Fn | Capabilities };

/** Runs code that sees only the `capabilities` passed in; their calls come back here. The `engine`
 *  isolates it — `quickjs` (default, any runtime) or `worker` (Deno). A timeout ends the engine and
 *  every run in it. */
export class Sandbox {
  #fns = new Map<string, Fn>(); // capability path, joined by "\0"
  #timeout: number;
  #engine: Engine;

  constructor(
    { capabilities = {}, timeout = 30_000, engine = quickjs }:
      { capabilities?: Capabilities; timeout?: number; engine?: EngineFactory } = {},
  ) {
    this.#timeout = timeout;
    const walk = (o: Capabilities, path: string[]) => {
      for (const [k, v] of Object.entries(o)) {
        typeof v === "function" ? this.#fns.set([...path, k].join("\0"), v) : walk(v, [...path, k]);
      }
    };
    walk(capabilities, []);
    const call = async (key: string, args: unknown[]) => await this.#fns.get(key)!(...args);
    this.#engine = engine({ keys: [...this.#fns.keys()], call, timeout });
  }

  /** Runs `source` (a function or its source) as `fn(input, capabilities)`; resolves with its result. */
  run<T = unknown>(source: string | Fn, input?: unknown): Promise<T> {
    const late = () => this.#engine.close(new Error(`Sandbox: no result after ${this.#timeout} ms`));
    const timer = setTimeout(late, this.#timeout);
    return Promise.try(() => this.#engine.run(String(source), input)).finally(() => clearTimeout(timer)) as Promise<T>;
  }

  /** Ends the engine; running runs fail. The next run starts a new one. */
  close(): void {
    this.#engine.close(new Error("Sandbox: closed"));
  }

  [Symbol.dispose](): void {
    this.close();
  }
}
