/* Field names. The label is what the editor types; the name is the storage key, created once and
 * then kept, so old entries stay valid. */
/**
 * Reserved names (as `fieldName()` produces them). `your_name` is the honeypot. `then` would make
 * the settings proxy a thenable, so `await settings.fields` would hang. `__proto__` becomes `proto`,
 * and lowercasing avoids `toString` etc.
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
