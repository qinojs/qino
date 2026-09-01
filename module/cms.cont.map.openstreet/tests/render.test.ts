// deno-lint-ignore-file no-explicit-any
import { bildJsonItem, requestStorage } from "@qino/qino";
import { assert, assertEquals, assertStringIncludes, fakeT, testContext } from "@qino/qino/tests";

import { cms } from "../plugin.ts";
import manifest from "../manifest.json" with { type: "json" };

const { name, dependencies } = manifest;

/** Node fake over a real settings tree, so writes behave the way they do in the cms. */
function contNode(settings: Record<string, unknown>, opt: { edit?: boolean } = {}) {
  const saved: string[] = [];
  const item = bildJsonItem(JSON.stringify(settings), (json: string) => saved.push(json));
  return {
    id: 9,
    edit: !!opt.edit,
    app: { t: fakeT },
    settings: item.proxy,
    cms: { text: () => "" },
    saved,
  } as any;
}

const run = (node: any, ctx: any) => requestStorage.run(ctx, () => cms.node.render(node as never, { ctx }));

/** A Nominatim stand-in; returns the recorded requests. */
function stubFetch(reply: unknown[] | null) {
  const calls: string[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = ((input: string | URL | Request) => {
    calls.push(String(input));
    if (!reply) return Promise.resolve(new Response("", { status: 502 }));
    return Promise.resolve(new Response(JSON.stringify(reply), { headers: { "content-type": "application/json" } }));
  }) as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = original; } };
}

const MURTEN = [{ lat: "46.9284", lon: "7.1147", display_name: "Hauptgasse 1, 3280 Murten, Schweiz" }];

Deno.test("cms.cont.map.openstreet: metadata is wired", () => {
  assertEquals(name, "cms.cont.map.openstreet");
  assertEquals(dependencies, ["cms", "cms.text"]);
  assertEquals(cms.node.settingsSchema.properties.address.type, "string");
});

Deno.test("cms.cont.map.openstreet: coordinates place the marker, and the frame is simply there", async () => {
  const ctx = await testContext();
  const out = String(await run(contNode({ lat: 46.9284, lon: 7.1147 }), ctx));
  assertStringIncludes(out, "marker=46.9284,7.1147");
  assertStringIncludes(out, "<iframe");
  assertStringIncludes(out, 'title="Map"'); // no address to name it by
  assertStringIncludes(out, 'referrerpolicy="no-referrer"');
  assert(!out.includes("<button"), "no interstitial between the visitor and the map");
  assertEquals(ctx.res.csp["frame-src"]["https://www.openstreetmap.org"], true);
});

Deno.test("cms.cont.map.openstreet: an address is looked up once and remembered", async () => {
  const ctx = await testContext();
  const stub = stubFetch(MURTEN);
  try {
    const node = contNode({ address: "Hauptgasse 1, 3280 Murten" });
    assertStringIncludes(String(await run(node, ctx)), "marker=46.9284,7.1147");
    assertEquals(stub.calls.length, 1);
    assertStringIncludes(stub.calls[0], "nominatim.openstreetmap.org");
    assertStringIncludes(stub.calls[0], encodeURIComponent("Hauptgasse 1, 3280 Murten"));

    // The answer is in the settings, so the second render asks nobody.
    await new Promise((r) => setTimeout(r, 60));
    const stored = JSON.parse(node.saved.at(-1)!);
    assertEquals(stored.geo.q, "Hauptgasse 1, 3280 Murten");
    assertEquals(stored.geo.lat, 46.9284);

    const second = String(await run(node, ctx));
    assertStringIncludes(second, "marker=46.9284,7.1147");
    assertEquals(stub.calls.length, 1);
    // The address is the frame's accessible name — "Map" alone tells a screenreader nothing.
    assertStringIncludes(second, 'title="Map: Hauptgasse 1, 3280 Murten"');
  } finally {
    stub.restore();
  }
});

Deno.test("cms.cont.map.openstreet: typed coordinates override the address", async () => {
  const ctx = await testContext();
  const stub = stubFetch(MURTEN);
  try {
    const node = contNode({ address: "Hauptgasse 1, 3280 Murten", lat: 47, lon: 8 });
    assertStringIncludes(String(await run(node, ctx)), "marker=47,8");
    assertEquals(stub.calls.length, 0);
  } finally {
    stub.restore();
  }
});

Deno.test("cms.cont.map.openstreet: an unknown address is a note for the editor, nothing for the visitor", async () => {
  const ctx = await testContext();
  const stub = stubFetch([]);
  try {
    assertEquals(String(await run(contNode({ address: "Nowhere at all 7" }), ctx)), "");

    const editor = contNode({ address: "Nowhere at all 7" }, { edit: true });
    assertStringIncludes(String(await run(editor, ctx)), "was not found");
    // The miss is not written into the settings — a network hiccup must not stick.
    await new Promise((r) => setTimeout(r, 60));
    assertEquals(editor.saved.length, 0);
    // …and it is not asked again for an hour either.
    assertEquals(stub.calls.length, 1);
  } finally {
    stub.restore();
  }
});

Deno.test("cms.cont.map.openstreet: without any position the editor is told what to set", async () => {
  const ctx = await testContext();
  assertEquals(String(await run(contNode({}), ctx)), "");
  const out = String(await run(contNode({}, { edit: true }), ctx));
  assert(out.includes("Set an address"));
});
