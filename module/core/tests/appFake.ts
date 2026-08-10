/** Minimal `app.t`: substitutes the interpolated values, no lookup. */
export const fakeT = (strings: TemplateStringsArray, ...values: unknown[]): Promise<string> =>
  Promise.all(values).then((v) => strings.reduce((a, s, i) => a + s + (i < v.length ? String(v[i] ?? "") : ""), ""));
