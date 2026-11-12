/* t``, the same code on server and browser: the tagged template, t.in(ns) and t.with(scope, fn) over a
   source that translates (server: the database, browser: the api) and a scope carrying { ns, lang }. */

/** "Hello {0}" with ["Qino"] → "Hello Qino".
 * @param {string} text @param {unknown[]} values @returns {string} */
export const fill = (text, values) => values.reduce((s, v, i) => s.replaceAll(`{${i}}`, String(v ?? "")), text);

/**
 * `translate(ns, original, values, lang)` answers a text; `scope` is `{ get(), run(scope, fn) }`.
 * t`…` looks in the scope's namespace, else the global one (""); t.in(ns)`…` in `ns`; t.with(ns or
 * { ns, lang }, fn) runs fn with that scope.
 * @template R
 * @param {(ns: string, original: string, values: unknown[], lang?: string) => R} translate
 * @param {{ get(): { ns?: string, lang?: string } | undefined, run(scope: { ns?: string, lang?: string }, fn: () => any): any }} scope
 * @returns {((strings: TemplateStringsArray, ...values: unknown[]) => R) & {
 *   in(ns: string): (strings: TemplateStringsArray, ...values: unknown[]) => R,
 *   with<F>(to: string | { ns?: string, lang?: string }, fn: () => F): F }}
 */
export function tag(translate, scope) {
  const bound = (ns) => (strings, ...values) => {
    const s = scope.get();
    return translate(ns ?? s?.ns ?? "", strings.reduce((acc, str, i) => acc + `{${i - 1}}` + str), values, s?.lang);
  };
  const t = bound();
  t.in = bound;
  t.with = (to, fn) => scope.run({ ...scope.get(), ...typeof to === "string" ? { ns: to } : to }, fn);
  return t;
}
