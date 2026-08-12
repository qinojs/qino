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

/** Minimal `app.t`: substitutes the interpolated values, no lookup. */
export const fakeT = (strings: TemplateStringsArray, ...values: unknown[]): Promise<string> =>
  Promise.all(values).then((v) => strings.reduce((a, s, i) => a + s + (i < v.length ? String(v[i] ?? "") : ""), ""));
