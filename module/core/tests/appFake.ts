import { fill, tag } from "../pub/js/tag.js";

import type { T } from "../lib/LangManager.ts";

/** Settings fake shaped like the real item proxy: any path reads, an unset one awaits to undefined. */
// deno-lint-ignore no-explicit-any
export function fakeSettings(values: Record<string, any> = {}): any {
  return new Proxy(values, {
    get: (target, key) =>
      key in target ? target[key as string]
        : key === "then" ? (resolve: (v: unknown) => void) => resolve(undefined)
        : fakeSettings(),
  });
}

/** Minimal `app.t`, with t.in and t.with: substitutes the interpolated values, no lookup. */
export const fakeT: T = tag((_ns, original, values) => Promise.all(values).then((v) => fill(original, v)),
  { get: () => undefined, run: (_scope, fn) => fn() });
