import type { App } from "../../core/mod.ts";
import '../mod.ts';

export async function resolveText(app: App, value: string): Promise<string> {
    value = await replaceAsync(value, /cmspid:\/\/([0-9]+)/g, (_, pid) => replaceLinks(app, pid));
    value = await replaceAsync(value, /["\/]dbFile\/([0-9]+)\/(u-[^/]+\/)?/g, (_, id) => replaceFileUrls(app, id));
    return value;
}

async function replaceLinks(app: App, pid: string): Promise<string> {
    const page = await app.cms.node(Number(pid));
    if (!(await page.is())) {
        console.warn(`[content-issue] DeadInternalLink cmspid://${pid}`);
        return "#";
    }
    return page.url();
}

async function replaceFileUrls(app: App, id: string): Promise<string> {
    const file = await app.dbFiles.file(Number(id));
    if (await file.exists()) {
        const u = String(await file.get("md5") ?? "").slice(0, 5);
        return `/dbFile/${id}/u-${u}/`;
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
