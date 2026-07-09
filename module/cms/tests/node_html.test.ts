// deno-lint-ignore-file no-explicit-any
import "../plugin.ts";
import { assertEquals } from "../../core/tests/deps.ts";
import { RequestContext, requestStorage } from "../../core/mod.ts";
import { Node } from "../lib/Node.ts";

Deno.test("Node.htmlPrepared escapes module name inside qcms-mod attribute", async () => {
  const moduleName = `bad" onclick="alert(1) x="`;
  const ctx = new RequestContext();
  ctx.sess = { data: { core: { userId: () => 0 } } } as any;
  ctx.app = {
    modules: {
      get: () => ({
        name: moduleName,
        plugin: { cms: { node: { render: () => "<section></section>" } } },
      }),
    },
  } as any;

  const node = new Node({ app: ctx.app } as any, 1, { id: 1, module: moduleName, type: "c", visible: 0 });

  await requestStorage.run(ctx, async () => {
    assertEquals(
      String(await node.htmlPrepared()),
      '<section qcms-id=1 qcms-mod="bad&quot; onclick=&quot;alert(1) x=&quot;"></section>',
    );
  });
});
