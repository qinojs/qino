// deno-lint-ignore-file no-explicit-any

/** Runs code for a `Sandbox`. `run` resolves with the result of `source` as `fn(input, capabilities)`;
 *  `close` ends whatever runs and fails its runs with `error` — the next `run` starts afresh. */
export type Engine = { run(source: string, input: unknown): Promise<unknown>; close(error: Error): void };

/** Makes an engine. `keys` name the capabilities (path joined by "\0"), `call` runs one here;
 *  `timeout` (ms) bounds one stretch of code that never gives control back. */
export type EngineFactory = (options: {
  keys: string[];
  call: (key: string, args: unknown[]) => Promise<unknown>;
  timeout: number;
}) => Engine;

// Errors cross as plain data, both ways; the engines pass these into the sandbox as source.
export const pack = (e: any) => ({ name: e?.name, message: e?.message ?? String(e), code: e?.code, data: e?.data });
export const unpack = (e: { message: string }) => Object.assign(new Error(e.message), e);

// JSON for engines without structured clone — but keeping `undefined`, in arguments too.
export const encode = (v: unknown) => JSON.stringify(v, (_, x) => x === undefined ? { "\0": 0 } : x);
export const decode = (s: string) => {
  const gone = {}; // a reviver returning undefined would leave holes in arrays, so swap it in after
  const fix = (x: any): any => {
    if (x === gone) return undefined;
    if (x && typeof x === "object") for (const k in x) x[k] = fix(x[k]);
    return x;
  };
  return fix(JSON.parse(s, (_, x) => x?.["\0"] === 0 && Object.keys(x).length === 1 ? gone : x));
};

/** The capabilities as nested async functions; `call(key, args)` sends one out. Runs in the sandbox. */
export function capabilities(keys: string[], call: (key: string, args: unknown[]) => Promise<unknown>) {
  const caps: any = {};
  for (const key of keys) {
    const path = key.split("\0");
    let o = caps;
    for (const k of path.slice(0, -1)) o = o[k] ??= {};
    o[path.at(-1)!] = (...args: unknown[]) => call(key, args);
  }
  return caps;
}
