import { test } from "node:test";
import { assertEquals } from "@std/assert";
import { App, fs } from "@qino/qino";

import { geoip } from "../mod.ts";
import { ip4, ip6, Table } from "../lib/table.ts";

const gzip = (text: string) => new Response(new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"))).bytes();

test("locale.geoip: addresses as numbers", () => {
  assertEquals(ip4("1.2.3.4"), 0x01020304);
  assertEquals(ip4("255.255.255.255"), 2 ** 32 - 1);
  assertEquals(ip4("1.2.3"), undefined);
  assertEquals(ip4("1.2.3.256"), undefined);
  assertEquals(ip6("2001:db8::1"), 0x20010db800000000n);
  assertEquals(ip6("2001:db8:1:2:3:4:5:6"), 0x20010db800010002n);
  assertEquals(ip6("::"), 0n);
  assertEquals(ip6("fe80::1%eth0"), 0xfe80000000000000n);
  assertEquals(ip6("1::2::3"), undefined);
  assertEquals(ip6("1:2:3"), undefined);
});

test("locale.geoip: ranges in any order, gaps unknown, neighbours merged", async () => {
  const table = new Table();
  table.add(ip4("10.0.0.0")!, ip4("10.0.0.255")!, "DE");
  table.add(ip4("1.0.0.0")!, ip4("1.0.0.255")!, "CH");
  table.add(ip4("1.0.1.0")!, ip4("1.0.1.255")!, "CH");
  table.add(ip6("2a00::")!, ip6("2a00:ffff::")! + 0xffffffffn, "AT");
  await table.pack();
  assertEquals(table.size, { v4: 4, v6: 2 }); // CH, gap, DE, rest · AT, rest
  assertEquals(table.country("1.0.1.7"), "CH");
  assertEquals(table.country("5.5.5.5"), undefined);
  assertEquals(table.country("10.0.0.9"), "DE");
  assertEquals(table.country("10.0.1.0"), undefined);
  assertEquals(table.country("0.0.0.1"), undefined);
  assertEquals(table.country("::ffff:10.0.0.1"), "DE");
  assertEquals(table.country("2a00:1234::1"), "AT");
  assertEquals(table.country("2a01::1"), undefined);
  assertEquals(table.country("nonsense"), undefined);
});

test("locale.geoip: loads in the background from the cache, per source", async () => {
  const app = new App({ db: "sqlite::memory:", dir: await fs.tempDir() + "/" });
  app.stores.add(import.meta.resolve("../../store.json")).add("cron").add("locale.geoip");
  await app.init();
  try {
    const dir = `${app.dir}cache/locale.geoip/`;
    await fs.mkdir(dir + "dbip/");
    await fs.write(dir + "dbip/dbip.csv.gz", await gzip("1.0.0.0,1.0.0.255,AU\n1.0.1.0,1.0.1.255,ZZ\n2001:db8::,2001:db8:ffff:ffff:ffff:ffff:ffff:ffff,CH\n"));
    assertEquals(await geoip.country(app, "1.0.0.1"), undefined); // starts loading
    let hit;
    for (let i = 0; i < 100 && !hit; i++) hit = await new Promise((r) => setTimeout(r, 10)).then(() => geoip.country(app, "1.0.0.1"));
    assertEquals(hit, "AU");
    assertEquals(await geoip.country(app, "1.0.1.1"), undefined);
    assertEquals(await geoip.country(app, "2001:db8:5::1"), "CH");

    // RIR lines: count for IPv4, prefix length for IPv6, only handed-out blocks
    const rir = "2|ripencc|1|2|3\nripencc|*|ipv4|*|2|summary\nripencc|CH|ipv4|2.0.0.0|512|20000101|allocated|x\nripencc|DE|ipv4|2.0.2.0|256|20000101|reserved|x\nripencc|AT|ipv6|2a02::|32|20000101|assigned|x\n";
    await fs.mkdir(dir + "rir/");
    for (const name of ["afrinic", "apnic", "arin", "lacnic", "ripencc"]) await fs.write(`${dir}rir/${name}.txt.gz`, await gzip(name === "ripencc" ? rir : ""));
    await app.settings["locale.geoip"].source("rir");
    hit = undefined;
    for (let i = 0; i < 100 && !hit; i++) hit = await new Promise((r) => setTimeout(r, 10)).then(() => geoip.country(app, "2.0.1.255"));
    assertEquals(hit, "CH");
    assertEquals(await geoip.country(app, "2.0.2.1"), undefined);
    assertEquals(await geoip.country(app, "2a02:0:ffff::1"), "AT");
    assertEquals(await geoip.country(app, "2a02:1::1"), undefined);
  } finally {
    await app.db.close();
  }
});
