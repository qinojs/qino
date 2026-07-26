import { assertEquals, assertRejects, testContext } from "../../core/tests/deps.ts";
import { Db } from "../../core/lib/db/Db.ts";
import type { App } from "../../core/mod.ts";
import { frequencies, parseResult, rowsFor, setFrequency } from "../lib/monitor.ts";
import api from "../nodeApi.ts";
import { cron, dbSchema, name, needs } from "../plugin.ts";
import { render } from "../render.ts";

Deno.test("cms.backend.domain-monitor: schema and cron jobs are wired", () => {
  const domain = dbSchema.properties.monitor_domain.additionalProperties.properties;
  const check = dbSchema.properties.monitor_domain_check.additionalProperties.properties;
  assertEquals(name, "cms.backend.domain-monitor");
  assertEquals(needs, ["cms.backend", "cron"]);
  assertEquals(domain.check_frequency.enum, [...frequencies]);
  assertEquals(domain.check_frequency.default, "disabled");
  assertEquals(check.domain["x-qg-parent"], "monitor_domain");
  assertEquals(check.domain["x-qg-on-parent-delete"], "cascade");
  assertEquals(cron.hourly.every, "hour");
  assertEquals(cron.hourly.at, { minute: 30 });
  assertEquals(cron.hourly.jitter, 1800);
  assertEquals(cron.daily.every, "day");
  assertEquals(cron.daily.at, { hour: 12 });
  assertEquals(cron.daily.jitter, 43200);
  assertEquals(cron.weekly.every, "week");
  assertEquals(cron.weekly.at, { weekday: "sunday", hour: 4 });
  // every selectable frequency except "disabled" needs a job, or it would never run
  assertEquals(Object.keys(cron).sort(), frequencies.filter((v) => v !== "disabled").sort());
});

Deno.test("cms.backend.domain-monitor: frequency follows node access and validates values", async () => {
  const { db, app } = await testApp();
  try {
    await db.exec`INSERT INTO monitor_domain (domain, check_frequency, created, sort) VALUES (${"example.com"}, ${"disabled"}, ${1}, ${0})`;
    const node = { app };
    const response = await api(node as never, { frequency: "example.com", value: "hourly" }) as { rows: Record<string, string> };
    assertEquals(await db.one`SELECT check_frequency FROM monitor_domain WHERE domain = ${"example.com"}`, "hourly");
    assertEquals(response.rows["example.com"].includes("value=\"hourly\" selected"), true);
    assertEquals((await rowsFor(app, ["example.com"]))[0].domain, "example.com");
    await assertRejects(() => setFrequency(app, ["example.com"], "yearly"), TypeError, "Invalid check frequency");
    await db.table("monitor_domain_check").insert({ domain: "example.com", checked_at: 1, result: "{}" });
    assertEquals(await api(node as never, { delete: "example.com" }), { done: true });
    assertEquals(await db.one`SELECT count(*) FROM monitor_domain_check`, 0);
  } finally {
    await db.close();
  }
});

Deno.test("cms.backend.domain-monitor: one frequency call covers a whole selection", async () => {
  const { db, app } = await testApp();
  try {
    for (const domain of ["a.example", "b.example", "c.example"]) {
      await db.exec`INSERT INTO monitor_domain (domain, check_frequency, created, sort) VALUES (${domain}, ${"disabled"}, ${1}, ${0})`;
    }
    const response = await api({ app } as never, { frequency: "a.example,c.example", value: "weekly" }) as { rows: Record<string, string> };
    assertEquals(Object.keys(response.rows).sort(), ["a.example", "c.example"]);
    assertEquals(await db.one`SELECT check_frequency FROM monitor_domain WHERE domain = ${"a.example"}`, "weekly");
    assertEquals(await db.one`SELECT check_frequency FROM monitor_domain WHERE domain = ${"c.example"}`, "weekly");
    assertEquals(await db.one`SELECT check_frequency FROM monitor_domain WHERE domain = ${"b.example"}`, "disabled");

    assertEquals(await api({ app } as never, { delete: "a.example,c.example" }), { done: true });
    assertEquals(await db.query`SELECT domain FROM monitor_domain`, [{ domain: "b.example" }]);
  } finally {
    await db.close();
  }
});

Deno.test("cms.backend.domain-monitor: detail renders current and historical values safely", async () => {
  const { db, app } = await testApp();
  try {
    const result = {
      online: true,
      status_code: 200,
      response_time: 123,
      final_url: null,
      cert_valid: true,
      cert_days: 42,
      redirect_https: true,
      ipv6: false,
      www_ok: true,
      ns_answering: 2,
      ns_in_sync: true,
      dns_ns: "ns1.example.com",
      dns_a: "192.0.2.1",
      dns_aaaa: "",
      dns_mx: "",
      dns_txt: "",
      dns_caa: "",
      dns_dmarc: "",
      dns_changed: null,
      error: "<script>alert(1)</script>",
      checked: 1000,
    };
    const previous = {
      ...result,
      status_code: 503,
      response_time: 999,
      cert_days: 43,
      dns_a: "192.0.2.2",
      dns_changed: 800,
      checked: 900,
      log_id: 11,
      log_id_ch: 12,
    };
    await db.exec`INSERT INTO monitor_domain
      (domain, check_frequency, online, status_code, response_time, cert_valid, cert_days, checked, created, sort,
       ipv6, www_ok, redirect_https, ns_answering, ns_in_sync, dns_ns, dns_a, dns_txt)
      VALUES (${"example.com"}, ${"daily"}, ${true}, ${200}, ${123}, ${true}, ${42}, ${1000}, ${1}, ${0},
       ${false}, ${true}, ${true}, ${2}, ${true}, ${"ns1.example.com\nns2.example.com"}, ${"192.0.2.1"},
       ${'v=spf1 <script>alert(1)</script>'})`;
    await db.exec`INSERT INTO monitor_domain_check (domain, checked_at, result) VALUES (${"example.com"}, ${900}, ${JSON.stringify(previous)})`;
    await db.exec`INSERT INTO monitor_domain_check (domain, checked_at, result) VALUES (${"example.com"}, ${1000}, ${JSON.stringify(result)})`;
    const ctx = await testContext({ url: "http://qino.test/backend?domain=example.com", app: { db } });
    const out = String(await render({ app } as never, { ctx }));
    assertEquals(out.includes("Check history (2)"), true);
    assertEquals(out.includes("123 ms"), true);

    // grouped facts: every DNS record on its own line, tri-state flags spelled out
    assertEquals(out.includes("<th colspan=2 class=-group>DNS"), true);
    assertEquals(out.includes("<div>ns1.example.com</div><div>ns2.example.com</div>"), true);
    assertEquals(out.includes("<div>192.0.2.1</div>"), true);
    assertEquals(out.includes("42 days remaining"), true);
    // TXT records are foreign input and must not reach the page as markup
    assertEquals(out.includes("v=spf1 &lt;script&gt;alert(1)&lt;/script&gt;"), true);
    assertEquals(out.includes("<div>v=spf1 <script>"), false);
    assertEquals(out.includes("<b>status_code</b>"), true);
    assertEquals(out.includes("<b>dns_a</b>"), true);
    assertEquals(out.includes("<b>response_time</b>"), false);
    assertEquals(out.includes("<b>cert_days</b>"), false);
    assertEquals(out.includes("<b>checked</b>"), false);
    assertEquals(out.includes("<b>dns_changed</b>"), false);
    assertEquals(out.includes("<b>log_id</b>"), false);
    assertEquals(out.includes("<b>log_id_ch</b>"), false);
    assertEquals(out.includes("&lt;script&gt;alert(1)&lt;/script&gt;"), true);
    assertEquals(out.includes("<script>alert(1)</script>"), false);
    assertEquals(parseResult(JSON.stringify(result)), result);
    assertEquals(parseResult("{}"), undefined);
    assertEquals(parseResult("{"), undefined);
  } finally {
    await db.close();
  }
});

async function testApp(): Promise<{ db: Db; app: App }> {
  const db = new Db("sqlite::memory:");
  await db.query`CREATE TABLE monitor_domain (
    domain TEXT PRIMARY KEY, online INTEGER, status_code INTEGER, response_time INTEGER,
    final_url TEXT, cert_valid INTEGER, cert_days INTEGER, redirect_https INTEGER,
    ipv6 INTEGER, www_ok INTEGER, ns_answering INTEGER, ns_in_sync INTEGER,
    dns_ns TEXT, dns_a TEXT, dns_aaaa TEXT, dns_mx TEXT, dns_txt TEXT, dns_caa TEXT,
    dns_dmarc TEXT, dns_changed INTEGER, expect TEXT, check_frequency TEXT,
    error TEXT, checked INTEGER, created INTEGER, sort INTEGER
  )`;
  await db.query`CREATE TABLE monitor_domain_check (
    id INTEGER PRIMARY KEY AUTOINCREMENT, domain TEXT, checked_at INTEGER, result TEXT
  )`;
  db.schema = dbSchema;
  await db.loadTables();
  return { db, app: { db } as unknown as App };
}
