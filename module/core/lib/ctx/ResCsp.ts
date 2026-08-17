type Sources = Record<string, true>;

// Only a source ending in "/" is a path prefix in CSP — everything below it is already covered.
const collapse = (keys: string[]) => keys.filter((k) => !keys.some((o) => o !== k && o.endsWith("/") && k.startsWith(o)));

// Directives that fall back to default-src when absent — repeating what default-src already says is wasted bytes.
// base-uri, form-action and frame-ancestors have no such fallback and are always emitted.
const fallsBack = new Set(["font-src", "img-src", "script-src", "style-src", "connect-src", "frame-src"]);

/** Content-Security-Policy builder. Directives are typed fields; add a field for new ones. */
export class ResCsp {
  "default-src": Sources = { "'self'": true };
  "font-src":    Sources = { "*": true, "data:": true };
  "img-src":     Sources = { "'self'": true, "data:": true };
  "script-src":  Sources = { "'self'": true };
  "style-src":   Sources = { "'self'": true, "'unsafe-inline'": true };
  "connect-src": Sources = { "'self'": true };
  "frame-src":   Sources = { "'self'": true };
  "base-uri":    Sources = { "'self'": true };
  "form-action": Sources = { "'self'": true };
  /** Who may frame this site. Loosen it per site, not here. */
  "frame-ancestors": Sources = { "'self'": true };

  /** Violation-report endpoint, emitted as `report-uri`. Deprecated in favour of the Reporting API,
   *  but the only mechanism firefox and safari implement — and a policy carrying `report-to` makes
   *  them ignore `report-uri`, so sending both means those browsers report nothing at all. */
  reportTo: string | undefined;

  toHeader(): string {
    const parts: string[] = [];
    let fallback = "";
    for (const [type, allowed] of Object.entries(this) as [string, Sources][]) {
      if (type === "reportTo") continue;
      let keys = collapse(Object.keys(allowed));
      // 'report-sample' opts violation reports into a sample of the offending code
      if (type === "script-src" || type === "style-src") keys = [...keys, "'report-sample'"];
      // 'none' is meaningless once other sources are present
      else if (type === "default-src" && keys.length > 1) keys = keys.filter((k) => k !== "'none'");
      if (!keys.length) continue;
      const value = keys.join(" ");
      if (type === "default-src") fallback = value;
      else if (value === fallback && fallsBack.has(type)) continue;
      parts.push(type + " " + value);
    }
    if (this.reportTo) parts.push("report-uri " + this.reportTo);
    return parts.join("; ");
  }
}
