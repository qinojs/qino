import { cms } from "./CMS.ts";

import type { App } from "@qino/qino";

/** `links`: resolve `cmspid://` too. Off in edit mode — the editor saves the html back, where a fixed
 *  url would break once the page url changes. File urls are a cache buster and always resolved. */
export async function resolveText(app: App, value: string, links = true): Promise<string> {
  if (links) value = await replaceAsync(value, /cmspid:\/\/([0-9]+)/g, (_, pid) => replaceLinks(app, pid));
  value = await replaceAsync(value, /\/dbFile\/([0-9]+)\/(u-[^/]+\/)?/g, (_, id) => replaceFileUrls(app, id));
  return value;
}

async function replaceLinks(app: App, pid: string): Promise<string> {
  const page = await cms(app).node(Number(pid));
  if (!page.exists()) {
    console.warn(`[content-issue] DeadInternalLink cmspid://${pid}`);
    return "#";
  }
  return page.url();
}

async function replaceFileUrls(app: App, id: string): Promise<string> {
  const file = await app.dbFiles.file(Number(id));
  if (await file.exists()) {
    return `/dbFile/${id}/u-${String(await file.get("md5") ?? "").slice(0, 5)}/`;
  }
  console.warn(`[content-issue] MissingFile dbFile://${id}`);
  return `/dbFile/${id}/`;
}

async function replaceAsync(str: string, regex: RegExp, fn: (match: string, ...groups: string[]) => Promise<string>): Promise<string> {
  let result = "", last = 0;
  for (const m of str.matchAll(regex)) {
    result += str.slice(last, m.index) + await fn(m[0], ...m.slice(1));
    last = m.index! + m[0].length;
  }
  return result + str.slice(last);
}
