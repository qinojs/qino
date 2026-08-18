export const suspiciousPathDefaults = [
  "/wp-*",
  "*/wp-admin*",
  "*/wp-login.php",
  "*/wp-content*",
  "*/wp-includes*",
  "*/xmlrpc.php",
  "*/wlwmanifest.xml",
  "*/.env",
  "*/.git*",
  "*/phpmyadmin*",
  "*/pma*",
  "*/adminer*",
  "*/composer.json",
  "*/vendor*",
];

export const allowedPathDefaults: string[] = [];

export function normalizePathList(text: string) {
  return parsePathList(text).join("\n");
}

export function parsePathList(text: string) {
  const seen = new Set<string>();
  return text.split(/\r?\n/)
    .map(s => s.trim())
    .filter(s => s && !s.startsWith("#"))
    .filter(validPattern)
    .filter(s => !seen.has(s.toLowerCase()) && seen.add(s.toLowerCase()));
}

/** Match-ready list of a setting value: parsed and lowercased once per distinct text. */
const compiled = new Map<string, string[]>();
export function pathList(text: string): string[] {
  let list = compiled.get(text);
  if (!list) {
    if (compiled.size > 50) compiled.clear(); // only setting values land here; an edited list leaves a dead entry
    compiled.set(text, list = parsePathList(text).map(s => s.toLowerCase()));
  }
  return list;
}

/** Patterns must already be lowercase — use `pathList()`. */
export function matchPath(patterns: string[], path: string) {
  const p = path.toLowerCase();
  const p2 = p.startsWith("/") ? p.slice(1) : "/" + p;
  return patterns.find(pattern => match(pattern, p) || match(pattern, p2)) ?? "";
}

function match(pattern: string, path: string) {
  const start = pattern.startsWith("*");
  const end = pattern.endsWith("*");
  const value = pattern.slice(start ? 1 : 0, end ? -1 : undefined);
  if (!value) return false;
  if (start && end) return path.includes(value);
  if (start) return path.endsWith(value);
  if (end) return path.startsWith(value);
  return path === value;
}

function validPattern(pattern: string) {
  return pattern.replace(/^\*+|\*+$/g, "").length >= 3;
}
