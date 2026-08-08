/**
 * reporter.js runs on two sides:
 *  - Deno backend:  wraps console.error/warn via reporterJsOptions → addReport() → DB
 *  - Browser:       mod.js served, reporterJsOptions.url → /js-error endpoint → DB
 */

import dbSchema from "./dbschema.json" with { type: "json" };
import { getCtx, type Ctx, Output, type App } from "../core/mod.ts";

const REPORTER_ROOT = "https://cdn.jsdelivr.net/gh/nuxodin/reporter.js@1.2.0/";
const REPORTER_PATH = REPORTER_ROOT + "mod.js";

(globalThis as any).reporterJsOptions = { console: ["error", "warn"] };
await import(REPORTER_PATH);

type Report = Record<string, unknown>;

export const name = "error_report";
export const description = "Collects backend, browser, CSS, and CSP errors for diagnosis.";
export const needs = ["core"];
export { healthChecks } from "./healthChecks.ts";
export { dbSchema };

export const settingsSchema = {
  properties: {
    browserErrors: {
      type: "boolean",
      description: "Enables or disables client-side error reporting.",
    },
  },
};

async function handleJsError(ctx: Ctx): Promise<void> {
  const report = ctx.req.body;
  if (report?.message) {
    await addReport(ctx.app, { source: "js", ...report });
  }
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

async function handleCspError(ctx: Ctx): Promise<void> {
  const report = ctx.req.body?.["csp-report"] as Report;
  if (report) {
    const directive = report["effective-directive"] ?? report["violated-directive"] ?? "";
    let blockedUri = report["blocked-uri"] ?? "";
    if (typeof blockedUri === "string" && /^https?:/.test(blockedUri)) {
      try { blockedUri = new URL(blockedUri).origin; } catch { /* keep invalid browser URL as-is */ }
    }
    const reportOnly = report.disposition === "report";
    await addReport(ctx.app, {
      message: (reportOnly ? "Report only: " : "Blocked: ") + `"${blockedUri}" blocked by "${directive}"`,
      source: "csp",
      file: report["source-file"] ?? "",
      line: report["line-number"] ?? "",
      request: report["document-uri"] ?? "",
      referer: report.referrer ?? "",
      backtrace: [],
      sample: report["script-sample"] ?? null,
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
  if (Array.isArray(row.backtrace)) row.backtrace = JSON.stringify(row.backtrace);
  await app.db.table("m_error_report").insert(row).catch(() => {});
}

export function init(app: App, { signal }: { signal: AbortSignal }): void {

  const reporter = (globalThis as any).reporterJsOptions;
  reporter.onError = async (data: Report) => {
    data.source ??= "deno";
    await addReport(app, data);
  };
  signal.addEventListener("abort", () => { delete reporter.onError; }, { once: true });

  app.on("route", ({ ctx }) => {
    if (ctx.req.appPath === "js-error")  return handleJsError(ctx);
    if (ctx.req.appPath === "css-error") return handleCssError(ctx);
    if (ctx.req.appPath === "csp-error") return handleCspError(ctx);
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
    if (!ctx.res.hasHtml || !await ctx.app.settings.error_report.browserErrors) return;
    ctx.res.html.jsData.reporterJsOptions = { url: ctx.req.appUrl + "js-error", max: 50 };
    ctx.res.csp["script-src"][REPORTER_ROOT] = true;
    ctx.res.html.legacyScripts.add(REPORTER_PATH);
    ctx.res.csp.reportTo = ctx.req.appUrl + "csp-error";
  }, { signal });
}
