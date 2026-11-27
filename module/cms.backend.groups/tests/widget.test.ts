import { test } from "node:test";
import { assertStringIncludes } from "@qino/qino/tests";

import { backendDashboardWidget } from "../plugin.ts";

test("cms.backend.groups: dashboard widget links the largest groups", async () => {
  const app = {
    db: {
      query: () => Promise.resolve([{ id: 4, name: "<admin>", members: 3 }, { id: 1, name: "team", members: 1 }]),
    },
    t: (s: TemplateStringsArray) => Promise.resolve(s.join("")),
  } as unknown as Parameters<typeof backendDashboardWidget>[0];
  const page = { url: () => Promise.resolve("/backend/groups") } as never;
  const out = String(await backendDashboardWidget(app, page));
  assertStringIncludes(out, `<a href="/backend/groups?id=4">&lt;admin&gt;</a><td>3`);
  assertStringIncludes(out, `<a href="/backend/groups?id=1">team</a><td>1`);
});
