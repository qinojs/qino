import type { App } from "@qino/qino";

type Lists = {
  starts?: string[];    // the start of the path
  segments?: string[];  // a whole path segment
  contains?: string[];  // anywhere in the path
  ends?: string[];      // the end of the path
};

/** Never a real link on any site: secrets, repositories, server internals, dumps. */
export const suspiciousPaths = (app: App, signal: AbortSignal): void => report(app, signal, 20, "suspicious path", {
  starts: ["_profiler/", "vendor/phpunit/"],
  segments: [".env", ".git", ".svn", ".hg", ".htaccess", ".htpasswd", ".aws", ".ssh", ".ds_store"],
  contains: ["phpinfo", "php-info", "_environment", "server-status", "server-info", "wp-config"],
  ends: [".sql", ".bak", ".swp"],
});

/** Paths of other systems. Real links of a replaced site look the same — turn off `security.foreignPaths` then. */
export const foreignPaths = (app: App, signal: AbortSignal): void => report(app, signal, 5, "foreign path", {
  starts: ["js/", "css/", "assets/", "cgi-bin/", "wp-admin/", "wp-content/", "wp-includes/", "phpmyadmin", "pma/", "adminer"],
  segments: ["xmlrpc.php", "wp-login.php", "wlwmanifest.xml"],
  ends: [".php", ".asp", ".aspx", ".jsp", ".cgi"],
}, async () => Boolean(await app.settings.security.foreignPaths ?? true));

// An empty list becomes (?!), which never matches.
const any = (list: string[] = []) => list.map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|") || "(?!)";

/** Reports a 404 whose path matches one of the lists (case-insensitive); a path that exists or is redirected costs nothing. */
function report(app: App, signal: AbortSignal, weight: number, reason: string, lists: Lists, enabled?: () => Promise<boolean>): void {
  const re = new RegExp(`^(${any(lists.starts)})|(^|/)(${any(lists.segments)})(/|$)|${any(lists.contains)}|(${any(lists.ends)})$`, "i");
  app.on("respond", ({ ctx }) => {
    if (ctx.res.status !== 404) return;
    const path = ctx.req.appPath;
    if (!re.test(path)) return;
    const fire = () => app.fire("suspicious", { ctx, weight, reason: `${reason}: ${path.slice(0, 100)}` });
    (enabled ? enabled().then((on) => { if (on) return fire(); }) : fire()).catch(() => {});
  }, { signal });
}
