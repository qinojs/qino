type Sources = Record<string, true>;

// Only a source ending in "/" is a path prefix in CSP; it covers everything below.
const collapse = (keys: string[]) => keys.filter((k) => !keys.some((o) => o !== k && o.endsWith("/") && k.startsWith(o)));

// Directives falling back to default-src; omitted when equal to it. base-uri, form-action and
// frame-ancestors have no fallback and are always sent.
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

  /** Report endpoint, sent as `report-uri`. Deprecated, but the only one Firefox and Safari support —
   *  and with `report-to` present they ignore `report-uri`, so only this one is sent. */
  reportTo: string | undefined;

  toHeader(): string {
    const parts: string[] = [];
    let fallback = "";
    for (const [type, allowed] of Object.entries(this) as [string, Sources][]) {
      if (type === "reportTo") continue;
      let keys = collapse(Object.keys(allowed));
      // 'report-sample' adds a code sample to reports
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
