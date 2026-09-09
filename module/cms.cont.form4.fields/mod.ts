/* What a field is called. The label is what the editor types, the name is what the value is
 * stored under — made once, then left alone, so old entries keep their meaning. */
/**
 * Names a field may not take, in the shape `fieldName()` produces. `your_name` is the
 * honeypot below. `then` is the one key that turns an object into a thenable: harmless in
 * the value bag, where it is only ever a string, but the settings proxy makes every child
 * callable — `await settings.fields` would hang on it. Nothing else needs an entry:
 * `__proto__` comes out as `proto`, and lowercasing keeps `toString` and friends away.
 */
export const RESERVED = new Set(["your_name", "then"]);

/** Field name for a typed label: "Ihre Bemerkung" → ihre_bemerkung. Made once, then left alone. */
export function fieldName(label: string): string {
  const name = label
    .toLowerCase()
    .replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64);
  if (!name) return "feld";
  return RESERVED.has(name) ? name + "_" : name; // trailing _ keeps the word, drops the meaning
}
