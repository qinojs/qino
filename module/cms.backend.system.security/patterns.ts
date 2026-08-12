export type Pattern = [RegExp, string, number, number];

export const probes: Pattern[] = [
  [/\/wp-(admin|content|includes|login\.php|json)\b/i, "wordpress probe", 80, 90],
  [/\/(xmlrpc\.php|wlwmanifest\.xml)\b/i, "wordpress xmlrpc", 80, 90],
  [/\/(\.env|\.git|composer\.(json|lock)|package(-lock)?\.json)\b/i, "sensitive file probe", 90, 95],
  [/\/(phpmyadmin|pma|adminer|mysql|dbadmin)\b/i, "db admin probe", 75, 85],
  [/\/(cgi-bin|vendor|storage|backup|bak|old)\b/i, "common exploit probe", 55, 70],
  [/\.(php|asp|aspx|cgi|pl)(\/|$|\?)/i, "foreign stack probe", 45, 65],
  [/(%2e%2e|\.\.\/|\/etc\/passwd|cmd=|eval\(|base64_)/i, "injection probe", 95, 90],
];

export const attacks: Pattern[] = [
  [/(<|%3c)\s*script\b|javascript\s*:|on(?:error|load|click|mouseover|focus|submit)\s*=|<\/?\s*iframe\b/i, "xss attempt", 120, 95],
  [/\b(union\s+select|information_schema|sleep\s*\(|benchmark\s*\(|load_file\s*\(|into\s+outfile)\b/i, "sql injection", 130, 96],
  [/\bselect\s+.+\bfrom\s+(information_schema|mysql\.|pg_|sys\.|users?|usr|admin|password)\b/i, "sql injection", 110, 82],
  [/('|%27|")\s*(or|and)\s+['"]?\d+['"]?\s*=\s*['"]?\d+|--\s|#|\/\*.*\*\//i, "sql injection", 120, 90],
  [/(\.\.\/|%2e%2e%2f|%252e%252e%252f|\/etc\/passwd|\/proc\/self\/environ|c:\\\\windows)/i, "path traversal", 120, 95],
  [/(;\s*(cat|id|whoami|wget|curl|bash|sh)\b|\|\s*(cat|id|whoami|wget|curl|bash|sh)\b|`[^`]+`|\$\([^)]*\))/i, "command injection", 130, 95],
  [/(?:^|[?&])(cmd|exec|shell|passthru|system|eval)=/i, "dangerous parameter", 100, 85],
];
