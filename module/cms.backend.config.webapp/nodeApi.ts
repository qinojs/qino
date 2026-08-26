import { APPLE_STATUS_BAR_STYLES, DISPLAY_MODES, ORIENTATIONS } from "@qino/qino/webapp";

import type { Node } from "@qino/qino/cms";

const DISPLAY = new Set(DISPLAY_MODES);
const ORIENTATION = new Set(ORIENTATIONS);
const APPLE_STATUS = new Set(APPLE_STATUS_BAR_STYLES);
const BOOL_FIELDS = new Set(["telephoneDetection"]);
const FIELDS = new Set([...BOOL_FIELDS, "display", "orientation", "categories", "appleStatusBarStyle"]);

function bool(value: unknown): boolean {
  return value === true || value === 1 || value === "1" || value === "true" || value === "on";
}

function normalized(path: string, value: unknown): string | boolean {
  if (BOOL_FIELDS.has(path)) return bool(value);
  let out = String(value ?? "").trim();
  if (path === "display" && !DISPLAY.has(out)) throw new Error("Invalid display mode");
  if (path === "orientation" && !ORIENTATION.has(out)) throw new Error("Invalid orientation");
  if (path === "appleStatusBarStyle" && !APPLE_STATUS.has(out)) throw new Error("Invalid Apple status bar style");
  if (path === "categories") {
    out = [...new Set(out.split(/[\r\n,]+/).map((v) => v.trim().toLowerCase()).filter(Boolean))].join("\n");
  }
  return out;
}

export default async function api(node: Node, vars: Record<string, unknown>): Promise<unknown> {
  if (vars.save && typeof vars.save === "object") {
    const settings = node.app.settings.webapp;
    for (const [path, value] of Object.entries(vars.save as Record<string, unknown>)) {
      if (FIELDS.has(path)) await settings[path](normalized(path, value));
    }
    return { done: true };
  }
  return false;
}
