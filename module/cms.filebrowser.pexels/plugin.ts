import { Access, type ApiTree, type App, type Ctx, type Params, s } from "@qino/qino";
import { cmsCtx } from "@qino/qino/cms";

export const api: ApiTree = {
  search: {
    get: {
      description: "Search free stock photos on Pexels (key stays server-side).",
      access: Access.USER,
      query: s.object({ s: s.optional(s.string()) }),
      execute: ({ s: needle }: Params, ctx: Ctx) => search(String(needle ?? ""), ctx),
    },
  },
};

export function init(app: App, { signal }: { signal: AbortSignal }) {
  app.on("cms:page-ready", async ({ ctx }) => {
    if (ctx.req.query.cms_noFrontend || !cmsCtx(ctx).editmode) return;
    if (!await app.settings["cms.filebrowser.pexels"].key) return; // no key, no Pexels UI
    ctx.res.csp["img-src"]["https://*.pexels.com"] = true;
    ctx.res.html.scripts.add(ctx.req.moduleUrl + "cms.filebrowser.pexels/pub/init.mjs");
  }, { signal });
}

const pexelsImg = (u: unknown) => typeof u === "string" && u.startsWith("https://images.pexels.com/");

async function search(needle: string, ctx: Ctx) {
  const key = String(await ctx.app.settings["cms.filebrowser.pexels"].key ?? "");
  if (!key || !needle) return [];
  const url = "https://api.pexels.com/v1/search?per_page=50&page=1&query=" + encodeURIComponent(needle);
  const res = await fetch(url, { headers: { Authorization: key } }).catch(() => null);
  if (!res?.ok) return [];
  // deno-lint-ignore no-explicit-any
  const data = await res.json().catch(() => null) as { photos?: any[] } | null;
  const photos = data?.photos ?? [];
  return photos
    .filter((p) => pexelsImg(p.src?.original) && pexelsImg(p.src?.medium))
    .map((p) => ({
      width: p.width,
      height: p.height,
      photographer: p.photographer,
      original: p.src.original,
      medium: p.src.medium,
    }));
}
