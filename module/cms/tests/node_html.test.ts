// deno-lint-ignore-file no-explicit-any
import "../plugin.ts";
import { assertEquals } from "../../core/tests/deps.ts";
import { RequestContext } from "../../core/mod.ts";
import { requestStorage } from "../../core/mod.ts";
import { Node } from "../lib/Node.ts";

Deno.test("Node.htmlPrepared keeps module name inside class attribute", async () => {
    const moduleName = `bad" onclick="alert(1) x="`;
    const ctx = new RequestContext();
    ctx.session = { liveUser: () => 0 } as any;
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
            '<section class="qgCmsCont -pid1 -m-badonclickalert1x"></section>',
        );
    });
});
