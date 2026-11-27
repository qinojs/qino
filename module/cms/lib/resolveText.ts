import type { CMS } from "./CMS.ts";

/** `links`: also resolve `cmspid://`. Off in edit mode, since the editor saves the html back and a
 *  fixed url would break when the page url changes. File urls are always resolved. */
export async function resolveText(cms: CMS, text: string, links = true): Promise<string> {
  if (links && text.includes("cmspid://")) {
    text = await replaceAsync(text, /cmspid:\/\/(\d+)/g, pid => replaceLinks(cms, pid));
  }
  return text.includes("/dbFile/")
    ? replaceAsync(text, /\/dbFile\/(\d+)\/(?:u-[^/]+\/)?/g, id => replaceFileUrls(cms, id))
    : text;
}

async function replaceLinks(cms: CMS, pid: string) {
  const page = await cms.node(Number(pid));
  if (!page.exists()) {
    console.warn(`[content-issue] DeadInternalLink cmspid://${pid}`);
    return "#";
  }
  return page.url();
}

async function replaceFileUrls(cms: CMS, id: string) {
  const file = await cms.app.dbFiles.file(Number(id));
  if (await file.exists()) return `/dbFile/${id}/u-${String(file.vs?.md5 ?? "").slice(0, 5)}/`;
  console.warn(`[content-issue] MissingFile dbFile://${id}`);
  return `/dbFile/${id}/`;
}

async function replaceAsync(str: string, regex: RegExp, fn: (id: string) => Promise<string>) {
  const parts = await Promise.all(str.matchAll(regex).map((m) => fn(m[1])));
  let i = 0;
  return str.replace(regex, () => parts[i++]);
}
