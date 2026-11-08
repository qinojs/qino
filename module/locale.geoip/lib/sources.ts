// Where the ranges come from. Each file arrives as a gzip stream and is kept that way in the cache;
// `parse` turns one line into a range of the table.
import { ip4, ip6 } from "./table.ts";

import type { Table } from "./table.ts";

/** `1.0.0.0,1.0.0.255,AU` — ZZ marks unassigned ranges, they stay unknown. */
function parseDbip(line: string, table: Table) {
  const [start, end, country] = line.split(",");
  if (!country || country === "ZZ") return;
  const ip = start.includes(":") ? ip6 : ip4;
  const [a, b] = [ip(start), ip(end)];
  if (a !== undefined && b !== undefined) table.add(a, b, country);
}

/** `ripencc|CH|ipv4|1.2.3.0|256|20000101|allocated|…` — IPv4 with a count of addresses, IPv6 with a
 *  prefix length. Only what is handed out counts, not `available` or `reserved`. */
function parseRir(line: string, table: Table) {
  const [, country, type, start, value, , status] = line.split("|");
  if (!/^[A-Z]{2}$/.test(country) || (status !== "allocated" && status !== "assigned")) return;
  if (type === "ipv4") {
    const a = ip4(start);
    if (a !== undefined) table.add(a, a + Number(value) - 1, country);
  } else if (type === "ipv6") {
    const a = ip6(start), bits = 64 - Number(value);
    if (a !== undefined) table.add(a, bits > 0 ? a + (1n << BigInt(bits)) - 1n : a, country);
  }
}

async function get(url: string) {
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`${url}: ${res.status}`);
  return res.body;
}

/** DB-IP publishes at the start of a month; until then last month's file is the latest. */
async function dbip() {
  const month = (back: number) => new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() - back)).toISOString().slice(0, 7);
  const url = (back: number) => `https://download.db-ip.com/free/dbip-country-lite-${month(back)}.csv.gz`;
  return get(url(0)).catch(() => get(url(1)));
}

const RIRS = {
  afrinic: "https://ftp.afrinic.net/pub/stats/afrinic/delegated-afrinic-extended-latest",
  apnic: "https://ftp.apnic.net/stats/apnic/delegated-apnic-extended-latest",
  arin: "https://ftp.arin.net/pub/stats/arin/delegated-arin-extended-latest",
  lacnic: "https://ftp.lacnic.net/pub/stats/lacnic/delegated-lacnic-extended-latest",
  ripencc: "https://ftp.ripe.net/pub/stats/ripencc/delegated-ripencc-extended-latest",
};

/** `files`: cache file name → gzip stream of its content.
 *  `dbip`: DB-IP Lite, where addresses are used (CC BY 4.0). `rir`: the five registries' delegation
 *  lists, where blocks were handed out (public). */
export const SOURCES = {
  dbip: { files: { "dbip.csv.gz": dbip }, parse: parseDbip },
  rir: {
    files: Object.fromEntries(Object.entries(RIRS).map(([name, url]) => [
      `${name}.txt.gz`,
      async () => (await get(url)).pipeThrough(new CompressionStream("gzip")),
    ])),
    parse: parseRir,
  },
};
