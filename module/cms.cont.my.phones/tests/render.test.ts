import { assertEquals, assertStringIncludes } from "../../core/tests/deps.ts";
import { cms, name, needs } from "../plugin.ts";

const t = (strings: TemplateStringsArray, ...values: unknown[]) =>
  Promise.all(values).then((v) => strings.reduce((a, s, i) => a + s + (i < v.length ? String(v[i] ?? "") : ""), ""));

Deno.test("cms.cont.my.phones renders the signed-in phone flow", async () => {
  assertEquals(name, "cms.cont.my.phones");
  assertEquals(needs, ["cms", "messaging.sms"]);
  const node = { app: { t } } as never;
  const output = String(await cms.node.render(node, { ctx: { user: {} } } as never));
  assertStringIncludes(output, "data-phones");
  assertStringIncludes(output, "type=tel");
  assertStringIncludes(String(await cms.node.render(node, { ctx: {} } as never)), "Please sign in.");
});
