// deno-lint-ignore-file no-explicit-any
import { assertEquals } from "../../core/tests/deps.ts";
import options from "../options.ts";
import { RequestContext, requestStorage } from "../../core/lib/RequestContext.ts";

function callable(value: unknown) {
  const fn = () => value;
  return fn;
}

function makeNode(settings: Record<string, unknown>) {
  return {
    id: 77,
    toString: () => "77",
    settings: new Proxy({}, {
      get(_target, prop: string) {
        return callable(settings[prop]);
      },
    }),
  };
}

Deno.test("cms.cont.table2: options renders bounded rows/cols and export URL", async () => {
  const ctx = new RequestContext();
  ctx.sysURL = "/m/";
  ctx.requestUri = "/page?x=1";
  const node = makeNode({ rows: 3, cols: 2, row_1: "40%", row_2: "60%" });

  const out = await requestStorage.run(ctx, () => options(node as any, {}));
  assertEquals(out.includes('value="3" min=1 max=300'), true);
  assertEquals(out.includes('value="2" min=1 max=15'), true);
  assertEquals(out.includes('value="40%" data-node="77" data-key="row_1"'), true);
  assertEquals(out.includes('value="60%" data-node="77" data-key="row_2"'), true);
  assertEquals(out.includes('href="/page?x=1&amp;export_table=77"'), true);
});

Deno.test("cms.cont.table2: options falls back to at least one row and column", async () => {
  const ctx = new RequestContext();
  ctx.sysURL = "/m/";
  ctx.requestUri = "/page";
  const node = makeNode({ rows: 0, cols: 0, row_1: `<bad>` });

  const out = await requestStorage.run(ctx, () => options(node as any, {}));
  assertEquals(out.includes('value="1" min=1 max=300'), true);
  assertEquals(out.includes('value="1" min=1 max=15'), true);
  assertEquals(out.includes('value="&lt;bad&gt;"'), true);
  assertEquals(out.includes('href="/page?export_table=77"'), true);
});
