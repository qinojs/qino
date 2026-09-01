/**
 * reporter.js runs on two sides:
 *  - Deno backend:  wraps console.error/warn via reporterJsOptions → addReport() → DB
 *  - Browser:       mod.js served, reporterJsOptions.url → /js-error endpoint → DB
 */
import { getCtx, Output, unixTime } from "@qino/qino";

import type { Ctx, App } from "@qino/qino";

const REPORTER_ROOT = "https://cdn.jsdelivr.net/gh/nuxodin/reporter.js@1.2.0/";
const REPORTER_PATH = REPORTER_ROOT + "mod.js";

(globalThis as any).reporterJsOptions = { console: ["error", "warn"] };
await import(REPORTER_PATH);

type Report = Record<string, unknown>;

export { healthChecks } from "./healthChecks.ts";
export { default as dbSchema } from "./dbschema.json" with { type: "json" };

export const settingsSchema = {
  properties: {
    browserErrors: {
      type: "boolean",
      description: "Enables or disables client-side error reporting.",
    },
  },
};

// The three report routes are open write paths: a browser has nothing to authenticate with, so
// neither has anyone else posting there. The cap is the only thing between them and the table (and
// the disk read in handleCssError). Counted per client in this process, not across workers.
const INTAKE_MAX = 20;
const INTAKE_WINDOW = 600;
const intake = new Map<string, { n: number; until: number }>();
function intakeAllowed(ctx: Ctx): boolean {
  const who = String(ctx.clientId || ctx.req.clientIp);
  const now = unixTime();
  const seen = intake.get(who);
  if (seen && seen.until > now) return ++seen.n <= INTAKE_MAX;
  if (intake.size > 5000) intake.clear(); // nothing else collects this map
  intake.set(who, { n: 1, until: now + INTAKE_WINDOW });
  return true;
}

async function handleJsError(ctx: Ctx): Promise<void> {
  const report = ctx.req.body;
  if (report?.message) await addReport(ctx.app, { source: "js", ...report });
  throw new Output({});
}

async function handleCssError(ctx: Ctx): Promise<void> {
  const file = ctx.req.header("referer");
  const message = ctx.req.query.message || "css-error";
  const report: Report = { source: "css", message, file, backtrace: [] };
  if (file) {
    try {
      const localPath = ctx.urlToLocalPath(file);
      if (!localPath) throw new Error("not a local file");
      if (!localPath.endsWith(".css")) throw new Error("not a css file");
      ctx.app.assertAllowedPath(localPath);
      const content = await Deno.readTextFile(localPath);
      const pos = content.indexOf(message);
      if (pos >= 0) {
        const lines = content.slice(0, pos).split("\n");
        report.line = lines.length;
        report.col = lines[lines.length - 1].length;
      }
    } catch { /* file not locally accessible */ }
  }
  await addReport(ctx.app, report);
  ctx.res.status = 500;
  throw new Output();
}

/** Browsers send either the legacy `report-uri` object or the Reporting-API batch that `report-to` uses. */
function cspReports(body: unknown): Report[] {
  if (Array.isArray(body)) return body.filter((r) => r?.type === "csp-violation" && r.body).map((r) => r.body);
  const legacy = (body as Report | undefined)?.["csp-report"];
  return legacy ? [legacy as Report] : [];
}

async function handleCspError(ctx: Ctx): Promise<void> {
  for (const report of cspReports(ctx.req.body)) {
    // the two formats spell the same fields differently
    const v = (...keys: string[]) => keys.map((k) => report[k]).find((x) => x != null) ?? "";
    const directive = v("effective-directive", "effectiveDirective", "violated-directive");
    let blockedUri = v("blocked-uri", "blockedURL");
    if (typeof blockedUri === "string" && /^https?:/.test(blockedUri)) {
      try { blockedUri = new URL(blockedUri).origin; } catch { /* keep invalid browser URL as-is */ }
    }
    const reportOnly = report.disposition === "report";
    await addReport(ctx.app, {
      message: (reportOnly ? "Report only: " : "Blocked: ") + `"${blockedUri}" blocked by "${directive}"`,
      source: "csp",
      file: v("source-file", "sourceFile"),
      line: v("line-number", "lineNumber"),
      request: v("document-uri", "documentURL"),
      referer: v("referrer"),
      backtrace: [],
      sample: v("script-sample", "sample") || null,
      prio: reportOnly ? "notice" : "warning",
    });
  }
  throw new Output({});
}

async function addReport(app: App, vs: Report): Promise<void> {
  const row: Report = {
    file: "",
    line: "",
    col: "",
    backtrace: [],
    source: "js",
    time: new Date().toISOString().slice(0, 19).replace("T", " "),
    ...vs,
  };
  try {
    const ctx = getCtx();
    row.request ??= ctx.req.appUrl + ctx.req.appPath;
    row.referer ??= ctx.req.header("referer");
    row.browser ??= ctx.req.header("user-agent");
    row.ip ??= ctx.req.clientIp;
    row.log_id ??= await ctx.logId;
  } catch { /* no request context available */ }
  // the column always holds a JSON array — a report from the browser may send anything at all
  row.backtrace = JSON.stringify(Array.isArray(row.backtrace) ? row.backtrace : []);
  await app.db.table("m_error_report").insert(row).catch(() => {});
}

/** Console wrapping is process-wide — there is one console. So the hook is installed once and
 *  routes to the app of the running request; only outside a request does it fall back. */
const apps = new Set<App>();

function reportingApp(): App | undefined {
  try { return getCtx().app; } catch { return [...apps][0]; } // no request: first app still running
}

export function init(app: App, { signal }: { signal: AbortSignal }): void {

  const reporter = (globalThis as any).reporterJsOptions;
  apps.add(app);
  reporter.onError ??= async (data: Report) => {
    data.source ??= "deno";
    const target = reportingApp();
    if (target) await addReport(target, data);
  };
  signal.addEventListener("abort", () => {
    apps.delete(app);
    if (!apps.size) delete reporter.onError;
  }, { once: true });

  app.on("route", async ({ ctx }) => {
    const path = ctx.req.appPath;
    if (path !== "js-error" && path !== "css-error" && path !== "csp-error") return;
    if (!intakeAllowed(ctx)) throw new Output({});
    if (path === "csp-error") return handleCspError(ctx); // csp reports are not covered by the setting
    if (!await app.settings.error_report.browserErrors) throw new Output({});
    if (path === "js-error") return handleJsError(ctx)
    if (path === "css-error") return handleCssError(ctx);
  }, { signal });

  // Track every 404 response (pages, api, dbFile, static). A direct visit of the
  // cms not-found page renders with status 200, so it is not reported.
  app.on("response-ready", async ({ request, res, peerAddr, ctx }) => {
    if (res.status !== 404) return;
    const report: Report = { source: "404", message: request.url, file: new URL(request.url).pathname, prio: "notice" };
    if (!ctx) { // static path has no request context, addReport can't fill these
      report.request = request.url;
      report.referer = request.headers.get("referer") ?? "";
      report.browser = request.headers.get("user-agent") ?? "";
      report.ip = peerAddr;
    }
    await addReport(app, report);
  }, { signal });

  // Log every "suspicious" signal (failed logins, enumeration probes, …). A future
  // security module scores the client from the same event; here we just record it.
  app.on("suspicious", ({ reason }) => addReport(app, {
    source: "suspicious",
    message: reason ?? "suspicious",
    prio: "warning",
  }), { signal });

  app.on("render", async ({ ctx }) => {
    if (!ctx.res.hasHtml) return;
    // the browser posts csp violations by itself — no reporter script and no browserErrors setting needed
    ctx.res.csp.reportTo = ctx.req.appUrl + "csp-error";
    if (!await ctx.app.settings.error_report.browserErrors) return;
    ctx.res.html.jsData.reporterJsOptions = { url: ctx.req.appUrl + "js-error", max: 50 };
    ctx.res.csp["script-src"][REPORTER_ROOT] = true;
    ctx.res.html.legacyScripts.add(REPORTER_PATH);
  }, { signal });
}
