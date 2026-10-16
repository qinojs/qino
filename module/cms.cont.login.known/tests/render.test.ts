import { requestStorage } from "@qino/qino";
import { assertEquals, fakeT, testContext } from "@qino/qino/tests";

import { cms } from "../plugin.ts";

import type { Node } from "@qino/qino/cms";

Deno.test("known accounts distinguish remembered logins from those needing a password", async () => {
  const ctx = await testContext({
    sess: { data: { core: { userId: () => 0, csrfToken: () => "tok" } } },
  });
  const users = [
    { save_login: true, user: () => ({ username: 'saved"><script>x</script>' }) },
    { save_login: false, user: () => ({ username: "known@example.test" }) },
  ];
  Object.defineProperty(ctx, "client", { value: { users: () => users } });
  const node = {
    app: { t: async (...args: Parameters<typeof fakeT>) => fakeT(...args) }, edit: () => false,
    settings: { history: () => 0, saveLogin: () => true },
  } as unknown as Node;
  const out = String(await requestStorage.run(ctx, () => cms.node.render(node, { ctx })));
  assertEquals(out.match(/<form /g)?.length, 2);
  assertEquals(out.match(/name=pw /g)?.length, 1);
  assertEquals(out.includes("saved&quot;&gt;&lt;script&gt;x&lt;/script&gt;"), true);
  assertEquals(out.includes("<script>"), false);
  assertEquals(out.includes('name=csrfToken value="' + ctx.csrfToken + '"'), true);
  assertEquals(out.includes("Stay logged in</label>"), true);
  assertEquals(out.includes("[object Promise]"), false);

  ctx.loginError = "password";
  const failed = String(await requestStorage.run(ctx, () => cms.node.render(node, { ctx })));
  assertEquals(failed.includes("Your login attempt failed</div>"), true);
  assertEquals(failed.includes("[object Promise]"), false);

  users.length = 0;
  assertEquals(String(await requestStorage.run(ctx, () => cms.node.render(node, { ctx }))), "");
});
