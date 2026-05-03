import type { App } from "../../core/server.ts";

export async function resolveText(app: App, value: string): Promise<string> {
    value = await replaceAsync(value ?? "", /cmspid:\/\/([0-9]+)/g, (_, pid) => replaceLinks(app, pid));
    value = await replaceAsync(value, /["\/]dbFile\/([0-9]+)\/(u-[^/]+\/)?/g, (_, id) => replaceFileUrls(app, id));
    return value;
}

async function replaceLinks(app: App, pid: string): Promise<string> {
    const page = await app.cms.node(parseInt(pid));
    if (!(await page.is())) {
        console.warn(`[content-issue] DeadInternalLink cmspid://${pid}`);
        return "#";
    }
    return page.url();
}

async function replaceFileUrls(app: App, id: string): Promise<string> {
    const file = app.dbFiles.file(parseInt(id));
    await file.name(); // loads data incl. path
    if (await file.exists()) {
        const u = String(await file.get("md5") ?? "").slice(0, 4);
        return `/dbFile/${id}/u-${u}/`;
    }
    console.warn(`[content-issue] MissingFile dbFile://${id}`);
    return `/dbFile/${id}/`;
}

async function replaceAsync(str: string, regex: RegExp, fn: (...args: any[]) => Promise<string>): Promise<string> {
    const matches: { match: string; args: any[]; index: number }[] = [];
    str.replace(regex, (...args) => { matches.push({ match: args[0], args, index: args[args.length - 2] }); return ""; });
    let result = "", last = 0;
    for (const m of matches) {
        result += str.slice(last, m.index) + await fn(...m.args);
        last = m.index + m.match.length;
    }
    return result + str.slice(last);
}
