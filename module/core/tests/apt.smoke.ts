/**
 * Smoketest für apt.ts — ohne Hono-Server, nur invoke() und client().
 * Läuft: deno run --allow-env m/core/apt.smoke.ts
 */

import { s } from "../lib/StandardSchema.ts";
import { AccessError, NotFoundError, toTools, invoke, aptClient } from "../lib/apt.ts";
import { requestStorage, RequestContext } from "../lib/RequestContext.ts";

// Provide a fake request context so getCtx() works
const fakeCtx = new RequestContext();
fakeCtx.lang = "de";

// A tiny fake CMS-ish tree
const mockPages = new Map<string, { id: string; title: string; access: () => number }>([
  ["1", { id: "1", title: "Home", access: () => 3 }],
  ["2", { id: "2", title: "Secret", access: () => 0 }],
]);

const api = {
  page: {
    ":page": {
      resolve: async (id: string) => {
        const p = mockPages.get(id);
        if (!p) throw new NotFoundError(`page ${id}`);
        if (p.access() < 1) throw new AccessError(`no view on ${id}`);
        return p;
      },
      get: {
        description: "Read page",
        execute: ({ page }: { page: { id: string; title: string; access: () => number } }) => ({ id: page.id, title: page.title }),
      },
      copy: {
        post: {
          description: "Copy a page",
          input: s.object({ deep: s.boolean().default(false) }),
          output: s.object({ id: s.string() }),
          execute: async ({ page, deep }: { page: { id: string; access: () => number }; deep: boolean }) => {
            if (page.access() < 2) throw new AccessError("copy needs write");
            return { id: page.id + "-copy" + (deep ? "-deep" : "") };
          },
        },
      },
    },
  },
};

// ───── Run tests ───────────────────────────────────────────────────────────

function withCtx<T>(fn: () => T): T {
  return requestStorage.run(fakeCtx, fn);
}

async function expect(label: string, fn: () => unknown, want: unknown) {
  try {
    const got = await withCtx(fn);
    const ok = JSON.stringify(got) === JSON.stringify(want);
    console.log(ok ? "OK  " : "FAIL", label, ok ? "" : `\n  got:  ${JSON.stringify(got)}\n  want: ${JSON.stringify(want)}`);
  } catch (e) {
    console.log("FAIL", label, "threw:", (e as Error).message);
  }
}

async function expectThrows(label: string, fn: () => unknown, errType: abstract new (...args: never[]) => Error) {
  try {
    await withCtx(fn);
    console.log("FAIL", label, "did not throw");
  } catch (e) {
    const ok = e instanceof errType;
    console.log(ok ? "OK  " : "FAIL", label, ok ? "" : `got ${(e as Error).name}`);
  }
}

await expect("invoke GET /node/1",
  () => invoke(api, "GET", "/node/1"),
  { id: "1", title: "Home" });

await expect("invoke POST /node/1/copy (default deep=false)",
  () => invoke(api, "POST", "/node/1/copy", {}),
  { id: "1-copy" });

await expect("invoke POST /node/1/copy (deep=true)",
  () => invoke(api, "POST", "/node/1/copy", { deep: true }),
  { id: "1-copy-deep" });

await expectThrows("invoke GET /node/2 (no access)",
  () => invoke(api, "GET", "/node/2"),
  AccessError);

await expectThrows("invoke GET /node/9 (not found)",
  () => invoke(api, "GET", "/node/9"),
  NotFoundError);

await expectThrows("invoke GET /page (missing param)",
  () => invoke(api, "GET", "/node"),
  NotFoundError);

// toTools
const tools = toTools(api);
console.log("\nGenerated tools:");
for (const t of tools) {
  console.log("  -", t.name, "—", t.description);
  console.log("    params:", JSON.stringify(t.parameters));
}

// client proxy
console.log("\nRPC client:");
const rpc = aptClient(api);
await expect("rpc.page('1').get()",
  () => rpc.page("1").get(),
  { id: "1", title: "Home" });

await expect("rpc.page('1').copy.post({ deep: true })",
  () => rpc.page("1").copy.post({ deep: true }),
  { id: "1-copy-deep" });
