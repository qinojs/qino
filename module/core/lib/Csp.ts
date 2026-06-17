type Sources = Record<string, true>;

/** Content-Security-Policy builder. Directives are typed fields; add a field for new ones. */
export class Csp {
  "default-src": Sources = { "'self'": true };
  "font-src":    Sources = { "*": true, "data:": true };
  "img-src":     Sources = { "'self'": true, "data:": true };
  "script-src":  Sources = { "'self'": true };
  "style-src":   Sources = { "'self'": true, "'unsafe-inline'": true };
  "connect-src": Sources = { "'self'": true };
  "frame-src":   Sources = { "'self'": true };

  reportUri: string | false = false;

  toHeader(): string {
    this["script-src"]["'report-sample'"] = true;
    this["style-src"]["'report-sample'"] = true;
    const def = this["default-src"];
    if (def["'none'"] && Object.keys(def).length > 1) delete def["'none'"];

    let s = "";
    for (const [type, allowed] of Object.entries(this) as [string, Sources][]) {
      if (type === "reportUri") continue;
      if (!Object.keys(allowed).length) continue;
      s += type + " " + Object.keys(allowed).join(" ") + "; ";
    }
    if (this.reportUri) s += "report-uri " + this.reportUri + "; ";
    return s;
  }
}
