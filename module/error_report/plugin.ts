/**
 * reporter.js runs on two sides:
 *  - Deno backend:  wraps console.error/warn via reporterJsOptions → addReport() → DB
 *  - Browser:       mod.js served, reporterJsOptions.url → /js-error endpoint → DB
 */

import dbSchema from "./dbschema.json" with { type: "json" };
import { getCtx, type Ctx, Output, type App } from "../core/mod.ts";

const reporterRoot = "https://cdn.jsdelivr.net/gh/nuxodin/reporter.js@1.2.0/";
const reporterPath = reporterRoot + "mod.js";

(globalThis as any).reporterJsOptions = { console: ["error", "warn"] };
await import(reporterPath);

type Report = Record<string, unknown>;

export const name = "error_report";
export const needs = ["core"];
export { dbSchema };
export { healthChecks } from "./healthChecks.ts";

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
      referer: report["referrer"] ?? "",
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
    row.request ??= ctx.req.basePath + ctx.req.appPath;
    row.referer ??= ctx.req.header("referer");
    row.browser ??= ctx.req.header("user-agent");
    row.ip ??= ctx.req.clientIp;
    row.log_id ??= await ctx.logId;
  } catch { /* no request context available */ }
  if (Array.isArray(row.backtrace)) row.backtrace = JSON.stringify(row.backtrace);
  await app.db.table("m_error_report").insert(row).catch(() => {});
}

export function init(app: App): void {

  (globalThis as any).reporterJsOptions.onError = async (data: Report) => {
    data.source ??= "deno";
    await addReport(app, data);
  };

  app.on("route", ({ ctx }) => {
    if (ctx.req.appPath === "js-error")  return handleJsError(ctx);
    if (ctx.req.appPath === "css-error") return handleCssError(ctx);
    if (ctx.req.appPath === "csp-error") return handleCspError(ctx);
  });

  app.on("render", async ({ ctx }) => {
    if (!ctx.res.hasHtml) return;
    const browserErrorsEnabled = await ctx.app.settings.error_report.browserErrors;
    if (!browserErrorsEnabled) return;
    ctx.res.html.jsData.reporterJsOptions = { url: ctx.req.basePath + "js-error", max: 50 };
    ctx.res.csp["script-src"][reporterRoot] = true;
    ctx.res.html.legacyScripts.add(reporterPath);
    ctx.res.csp.reportUri = ctx.req.basePath + "csp-error";
  });
}
