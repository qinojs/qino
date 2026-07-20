type Sources = Record<string, true>;

/** Content-Security-Policy builder. Directives are typed fields; add a field for new ones. */
export class ResCsp {
  "default-src": Sources = { "'self'": true };
  "font-src":    Sources = { "*": true, "data:": true };
  "img-src":     Sources = { "'self'": true, "data:": true };
  "script-src":  Sources = { "'self'": true };
  "style-src":   Sources = { "'self'": true, "'unsafe-inline'": true };
  "connect-src": Sources = { "'self'": true };
  "frame-src":   Sources = { "'self'": true };

  /** Violation-report endpoint. Emitted as `report-to`; pair with the `Reporting-Endpoints` header (see reportingEndpoints). */
  reportTo: string | undefined;

  toHeader(): string {
    let s = "";
    for (const [type, allowed] of Object.entries(this) as [string, Sources][]) {
      if (type === "reportTo") continue;
      let keys = Object.keys(allowed);
      // 'report-sample' opts violation reports into a sample of the offending code
      if (type === "script-src" || type === "style-src") keys = [...keys, "'report-sample'"];
      // 'none' is meaningless once other sources are present
      else if (type === "default-src" && keys.length > 1) keys = keys.filter((k) => k !== "'none'");
      if (!keys.length) continue;
      s += type + " " + keys.join(" ") + "; ";
    }
    if (this.reportTo) s += "report-to csp; ";
    return s;
  }

  /** Value for the `Reporting-Endpoints` response header, or undefined when no endpoint is set. */
  reportingEndpoints(): string | undefined {
    return this.reportTo ? `csp="${this.reportTo}"` : undefined;
  }
}
