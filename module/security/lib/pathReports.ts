import type { App } from "@qino/qino";

/** Never a real link on any site: secrets, repositories, server internals, dumps. */
export const suspiciousPaths = (app: App, signal: AbortSignal): void => report(app, signal, {
  weight: 15,
  reason: "suspicious path",
  starts: ["_profiler/", "vendor/phpunit/"],
  segments: [".env", ".git", ".svn", ".hg", ".htaccess", ".htpasswd", ".aws", ".ssh", ".ds_store"],
  contains: ["phpinfo", "php-info", "_environment", "server-status", "server-info", "wp-config"],
  ends: [".sql", ".bak", ".swp"],
});

/** Paths of other systems. Real links of a replaced site look the same, hence `security.foreignPaths`. */
export const foreignPaths = (app: App, signal: AbortSignal): void => report(app, signal, {
  weight: 5,
  reason: "foreign path",
  starts: ["js/", "css/", "assets/", "cgi-bin/", "wp-admin/", "wp-content/", "wp-includes/", "phpmyadmin", "pma/", "adminer"],
  segments: ["xmlrpc.php", "wp-login.php", "wlwmanifest.xml"],
  ends: [".php", ".asp", ".aspx", ".jsp", ".cgi"],
  enabled: async () => await app.settings.security.foreignPaths,
});

// An empty list becomes (?!), which never matches.
const anyOf = (list: string[] = []) => list.map(RegExp.escape).join("|") || "(?!)";

/** Reports a 404 whose path matches one of the lists (case-insensitive); a path that exists or is redirected costs nothing. */
function report(app: App, signal: AbortSignal, { weight, reason, starts, segments, contains, ends, enabled = async () => true }: {
  weight: number;
  reason: string;
  starts?: string[];    // the start of the path
  segments?: string[];  // a whole path segment
  contains?: string[];  // anywhere in the path
  ends?: string[];      // the end of the path
  enabled?: () => Promise<unknown>;
}): void {
  const re = new RegExp(`^(${anyOf(starts)})|(^|/)(${anyOf(segments)})(/|$)|${anyOf(contains)}|(${anyOf(ends)})$`, "i");
  app.on("respond", ({ ctx }) => {
    if (ctx.res.status !== 404) return;
    const path = ctx.req.appPath;
    if (!re.test(path)) return;
    enabled().then((on) => on && app.fire("suspicious", { ctx, weight, reason: `${reason}: ${path.slice(0, 100)}` })).catch(() => {});
  }, { signal });
}
