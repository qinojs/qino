import { Output, getCtx, Access, fs, s, unixTime } from "@qino/qino";

import codemirrorView from "./view/codemirror.ts";
import { check } from "./lib/sign.ts";
import manifest from "./manifest.json" with { type: "json" };

import type { Ctx, ApiTree, App, Params } from "@qino/qino";

const { name } = manifest;

// Expired links are normal; a signature that never matched this session is suspicious and
// reported. Superusers need no signature.
async function allowed(ctx: Ctx, file: string, exp: unknown, sig: unknown): Promise<boolean> {
  if (ctx.user?.superuser) return true;
  const state = check(ctx, file, exp, sig);
  if (state !== "ok" && state !== "expired") {
    ctx.app.fire("suspicious", { ctx, weight: state === "forged" ? 3 : 1, reason: `fileEditor ${state} request` }).catch(() => {});
  }
  return state === "ok";
}

async function saveFile(ctx: Ctx, file: string, content: string, exp: unknown, sig: unknown): Promise<number> {
  ctx.app.assertAllowedPath(file);
  if (!await allowed(ctx, file, exp, sig)) return 0;

  const backupName = `fileEditorBackup_${encodeURIComponent(file)}_${Date.now()}`;
  const backupDir = ctx.app.modules.get(name)!.tmp;
  await fs.mkdir(backupDir).catch(() => {});
  await fs.copy(file, backupDir + backupName).catch(() => {});
  await fs.write(file, content);
  ctx.app.assetRev = unixTime(); // the file may be a served one, and its url has to change with it
  return 1;
}

export const api: ApiTree = {
  save: {
    put: {
      description: "Save file from the file editor.",
      access: Access.USER,
      // writing a runtime-loaded script is code execution, so it is worth a fresh proof
      requireStepUp: true,
      input: s.object({ file: s.string(), content: s.string(), exp: s.optional(s.string()), sig: s.optional(s.string()) }),
      execute: ({ file, content, exp, sig }: Params, ctx: Ctx) => saveFile(ctx, String(file), String(content), exp, sig),
    },
  },
};

function editorFile(): string | null {
  const ctx = getCtx();
  const file = ctx.req.query.file;
  return file && ctx.req.appPath === name ? file : null;
}

export function init(app: App, { signal }: { signal: AbortSignal }) {
  // A root route, not a CMS page: it builds the page and ends the request (else the cms would 404).
  app.on("route", async ({ ctx }) => {
    const file = editorFile();
    if (!file) return;
    ctx.app.assertAllowedPath(file);

    if (!await allowed(ctx, file, ctx.req.query.exp, ctx.req.query.sig)) throw new Output("no access");
    if (!await fs.isFile(file, { ttl: 0 })) throw new Output("file does not exist");

    ctx.res.html.content = await codemirrorView(file);
    throw new Output(); // the document on ctx.res is the response
  }, { signal });
}
