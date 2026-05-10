/**
 * error_report/mod.ts
 * Port of error_report/qg.php
 *
 * reporter.js läuft auf zwei Seiten:
 *  - Deno-Backend:  importiert, send() → direkt in DB schreiben
 *  - Browser:       mod.js serviert, reporterJsOptions.url → /js-error Endpoint → DB
 */
// deno-lint-ignore-file no-explicit-any

import dbSchema from "./dbschema.json" with { type: "json" };
import { OutputError } from "../core/lib/util.ts";
import type { App } from "../core/server.ts";
import type { Context } from "../../deps.ts";
import type { RequestContext } from "../core/lib/RequestContext.ts";

const reporterPath = "https://cdn.jsdelivr.net/gh/nuxodin/reporter.js@1.2.0/mod.js";
await import(reporterPath);

export const name = "error_report";
export const needs = ["core"];
export { dbSchema };

export const settingsSchema = {
  properties: {
    browserErrors: {
      type: "boolean",
      description: "Schaltet clientseitiges Fehlerreporting ein oder aus.",
    },
  },
};

export function routes(app: App): void {
  app.router.all("/js-error", (c) => handleJsError(c));
}

async function handleJsError(c: Context): Promise<Response> {
  const ctx = c.get("ctx") as RequestContext;
  const report = ctx.post as Record<string, any>;
  if (report.message) {
    report.source ??= "js";
    await errorReport(ctx, report);
  }
  return c.json({});
}

/** Schreibt einen Report direkt in die DB (kein HTTP-Roundtrip). */
async function insertReport(db: any, data: Record<string, any>): Promise<void> {
  const row = { ...data };
  if (Array.isArray(row.backtrace)) row.backtrace = JSON.stringify(row.backtrace);
  await db.table("m_error_report").insert(row).catch(() => {/* nie DB-Fehler nach außen werfen */},);
}

/** Füllt fehlende Felder aus dem Request-Context auf und schreibt in DB. */
async function errorReport(ctx: RequestContext, vs: Record<string, any>): Promise<void> {
  vs.file ??= "";
  vs.line ??= "";
  vs.col ??= "";
  vs.backtrace ??= [];
  vs.source ??= "js";
  vs.request ??= ctx.appURL + ctx.appRequestUri;
  vs.referer ??= ctx.server.HTTP_REFERER;
  vs.browser ??= ctx.server.HTTP_USER_AGENT;
  vs.ip ??= ctx.server.REMOTE_ADDR;
  vs.time ??= new Date().toISOString().slice(0, 19).replace("T", " ");
  vs.log_id ??= ctx.logId ?? null;
  await insertReport(ctx.app.db, vs);
}

export function init(app: App): void {
  // ── Config ───────────────────────────────────────────────────────────

  (globalThis as any).reporterJsOptions = {
    onError: async (data: Record<string, any>) => {
      data.source ??= "deno";
      data.time ??= new Date().toISOString().slice(0, 19).replace("T", " ");
      await insertReport(app.db, data);
    },
  };
  // ── HTTP-Endpoints ───────────────────────────────────────────────────────────

  app.on("action", async ({ ctx }: any) => {
    // CSS-Fehler
    if (ctx.appRequestUri.startsWith("css-error")) {
      const file = ctx.server.HTTP_REFERER;
      const message = (ctx.get.message as string) || "css-error";
      const report: Record<string, any> = {
        source: "css",
        message,
        file,
        backtrace: [],
      };
      if (file) {
        try {
          const content = await Deno.readTextFile(file);
          const before = content.split(message)[0];
          if (before !== undefined) {
            const lines = before.split("\n");
            report.line = lines.length;
            report.col = lines[lines.length - 1].length;
          }
        } catch { /* Datei nicht lokal zugänglich */ }
      }
      await errorReport(ctx, report);
      ctx.responseStatus = 500;
      throw new OutputError("");
    }

    // CSP-Verletzungen
    if (ctx.appRequestUri === "csp-error") {
      const cspReport = (ctx.post as any)?.["csp-report"] as
        | Record<string, any>
        | undefined;
      if (cspReport) {
        const directive = cspReport["effective-directive"] ?? cspReport["violated-directive"] ?? "";
        let blockedUri = cspReport["blocked-uri"] ?? "";
        if (/^https?:/.test(blockedUri)) {
          blockedUri = new URL(blockedUri).origin;
        }
        const reportOnly = !!ctx.responseHeaders.get("Content-Security-Policy-Report-Only");
        await errorReport(ctx, {
          message: (reportOnly ? "Report only: " : "Blocked: ") + `"${blockedUri}" blocked by "${directive}"`,
          source: "csp",
          file: cspReport["source-file"] ?? "",
          line: cspReport["line-number"] ?? "",
          request: cspReport["document-uri"] ?? "",
          referer: cspReport["referrer"] ?? "",
          backtrace: [],
          sample: cspReport["script-sample"] ?? null,
          prio: reportOnly ? "notice" : "warning",
        });
      }
      ctx.responseHeaders.set(
        "Content-Type",
        "application/json; charset=UTF-8",
      );
      throw new OutputError("{}");
    }
  });

  // ── Browser-Frontend: reporter.js + Konfiguration ins HTML injizieren ───────

  app.on("render", async ({ ctx }: any) => {
    if (!ctx.hasHtml) return;
    const browserErrorsEnabled = await ctx.app.settings.error_report.browserErrors;
    if (!browserErrorsEnabled) return;
    ctx.html.head += `<script>window.reporterJsOptions={url:${JSON.stringify(ctx.appURL + "js-error")},max:50};</script>\n`;
    ctx.html.addJSFile(reporterPath);
    ctx.cspReportUri = ctx.appURL + "csp-error";
  });
}

/**
 * error_report install()
 * Port of error_report/install.php
 */
export async function install({ app }: any): Promise<void> {
  app.settings.error_report.email;
  const legacyJavascript = await app.settings.error_report.javascript;
  const browserErrors = await app.settings.error_report.browserErrors;
  if (browserErrors === undefined) {
    app.settings.error_report.browserErrors = legacyJavascript ?? true;
  }
}
