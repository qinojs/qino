/** A legacy CSS length reduced to the value forms safe inside a style attribute. */
export function cssLength(value: unknown, unit = "px", fallback = ""): string {
  const str = String(value ?? "").trim();
  if (/^-?\d+(?:\.\d+)?$/.test(str)) return str + unit;
  return /^-?\d+(?:\.\d+)?(?:px|r?em|%|v[wh]|vmin|vmax)$/.test(str) ? str : fallback;
}
