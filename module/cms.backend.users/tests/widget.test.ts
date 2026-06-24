import { assertEquals } from "../../core/tests/deps.ts";
import { RequestContext, requestStorage } from "../../core/mod.ts";
import nodeApi from "../nodeApi.ts";
import { backendDashboardWidget, cms, name, needs } from "../plugin.ts";

Deno.test("cms.backend.users: metadata and cms export are wired", () => {
  assertEquals(name, "cms.backend.users");
  assertEquals(needs, ["cms.backend"]);
  assertEquals(typeof cms.node.api, "function");
  assertEquals(typeof cms.node.parts.list, "function");
});

Deno.test("cms.backend.users: dashboard widget renders counts and recent logins", async () => {
  const oneValues = [7, 5];
  const app = {
    db: {
      one: async () => oneValues.shift(),
      all: async () => [{ email: "user@example.test", access: 1700000000 }],
    },
    t: (s: TemplateStringsArray) => s.join(""),
  } as unknown as Parameters<typeof backendDashboardWidget>[0];
  const out = await backendDashboardWidget(app);
  assertEquals(out.includes("Total:<td>7"), true);
  assertEquals(out.includes("Active:<td>5"), true);
  assertEquals(out.includes("user@example.test"), true);
  assertEquals(out.includes("2023-11-14T22:13:20.000Z"), true);
});

Deno.test("cms.backend.users: empty password save is ignored", async () => {
  let saved = false;
  let setName = "";
  const entry = {
    is: async () => true,
    get: async () => false,
    set: async (name: string) => {
      setName = name;
    },
    save: async () => {
      saved = true;
    },
  };
  const ctx = new RequestContext();
  ctx.sess = { data: { liveUser: () => 0 } } as any;
  const node = {
    access: async () => 2,
    app: { db: { table: () => ({ entry: () => entry }) } },
  };

  const res = await requestStorage.run(ctx, () =>
    nodeApi(node as any, { save: 1, name: "pw", value: "" })
  );

  assertEquals(res, false);
  assertEquals(setName, "");
  assertEquals(saved, false);
});
