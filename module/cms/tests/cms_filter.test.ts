import { assertEquals } from "@qino/qino/tests";

import { CMS } from "../lib/CMS.ts";

const node = (id: number, type: string, readable: boolean) => ({
  id,
  vs: { type },
  isReadable: () => readable,
});

Deno.test("CMS.filter combines PHP-style tags and properties", async () => {
  const cms = new CMS({ db: {} } as never);
  const pages = new Map([
    [1, node(1, "p", true)],
    [2, node(2, "p", false)],
    [3, node(3, "c", true)],
    [4, node(4, "c", false)],
  ]) as never;

  assertEquals([...(await cms.filter(pages, "readable")).keys()], [1]);
  assertEquals([...(await cms.filter(pages, ["readable", { type: "c" }])).keys()], [3]);
});
