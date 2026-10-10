import { sys } from "@qino/qino";

import type { App } from "@qino/qino";

/** Tried in this order when the setting names none. */
const CANDIDATES = ["chromium", "chromium-browser", "google-chrome-stable", "google-chrome", "microsoft-edge"];

const runs = (cmd: string) =>
  sys.command(cmd, { args: ["--version"], stdout: "null", stderr: "null" }).then((o) => o.success);

// Which browser is installed is a fact of the machine, not of an app, so it is looked up once.
let found: Promise<string | undefined> | undefined;

/** The browser to print with: the setting, else the first one installed. */
export async function browser(app: App): Promise<string | undefined> {
  const set = String(await app.settings.pdf.browser ?? "");
  if (set) return set;
  return found ??= (async () => {
    for (const cmd of CANDIDATES) if (await runs(cmd).catch(() => false)) return cmd;
  })();
}
