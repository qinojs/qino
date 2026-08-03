import { assertEquals, assertRejects, testContext } from "../../core/tests/deps.ts";
import { Db, requestStorage, type App } from "../../core/mod.ts";
import { apex, covers, wwwAlt } from "../lib/check.ts";
import { errText } from "../lib/net.ts";
import { diffResults, pruneHistory } from "../lib/changes.ts";
import { dmarc, spf } from "../lib/mail.ts";
import { frequencies, normalizeDomain, parseResult, rowsFor, setFrequency } from "../lib/monitor.ts";
import api from "../nodeApi.ts";
import { cron, ctxSettingsSchema, dbSchema, name, needs } from "../plugin.ts";
import { backendDashboardWidget, render, rowHtml } from "../render.ts";

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
  assertEquals(frequencies.filter((v) => v !== "disabled").every((v) => v in cron), true);
  assertEquals(cron.prune.every, "day");
});

Deno.test("cms.backend.domain-monitor: frequency follows node access and validates values", async () => {
  const { db, app } = await testApp();
  try {
    await db.exec`INSERT INTO monitor_domain (domain, check_frequency, created, sort) VALUES (${"example.com"}, ${"disabled"}, ${1}, ${0})`;
    const node = testNode(app);
    const response = await inRequest(() => api(node as never, { frequency: "example.com", value: "hourly" })) as { rows: Record<string, string> };
    assertEquals(await db.one`SELECT check_frequency FROM monitor_domain WHERE domain = ${"example.com"}`, "hourly");
    assertEquals(response.rows["example.com"].includes("value=\"hourly\" selected"), true);
    assertEquals((await rowsFor(app, ["example.com"]))[0].domain, "example.com");
    await assertRejects(() => setFrequency(app, ["example.com"], "yearly"), TypeError, "Invalid check frequency");
    await db.table("monitor_domain_check").insert({ domain: "example.com", checked_at: 1, result: "{}" });
    assertEquals(await inRequest(() => api(node as never, { delete: "example.com" })), { done: true });
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
    const response = await inRequest(() => api(testNode(app) as never, { frequency: "a.example,c.example", value: "weekly" })) as { rows: Record<string, string> };
    assertEquals(Object.keys(response.rows).sort(), ["a.example", "c.example"]);
    assertEquals(await db.one`SELECT check_frequency FROM monitor_domain WHERE domain = ${"a.example"}`, "weekly");
    assertEquals(await db.one`SELECT check_frequency FROM monitor_domain WHERE domain = ${"c.example"}`, "weekly");
    assertEquals(await db.one`SELECT check_frequency FROM monitor_domain WHERE domain = ${"b.example"}`, "disabled");

    assertEquals(await inRequest(() => api(testNode(app) as never, { delete: "a.example,c.example" })), { done: true });
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
      ns_servers: "ns1.example.com 192.0.2.10 2024010101 ns1.example.com ns1.example.com,ns2.example.com\nns2.example.com",
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
       ipv6, www_ok, redirect_https, ns_servers, dns_ns, dns_a, dns_txt)
      VALUES (${"example.com"}, ${"daily"}, ${true}, ${200}, ${123}, ${true}, ${42}, ${1000}, ${1}, ${0},
       ${false}, ${true}, ${true},
       ${"ns1.example.com 192.0.2.10 2024010101 ns1.example.com ns1.example.com,ns2.example.com\nns2.example.com"},
       ${"ns1.example.com\nns2.example.com"}, ${"192.0.2.1"},
       ${'v=spf1 <script>alert(1)</script>'})`;
    await db.exec`INSERT INTO monitor_domain_check (domain, checked_at, result) VALUES (${"example.com"}, ${900}, ${JSON.stringify(previous)})`;
    await db.exec`INSERT INTO monitor_domain_check (domain, checked_at, result) VALUES (${"example.com"}, ${1000}, ${JSON.stringify(result)})`;
    const ctx = await testContext({ url: "http://qino.test/backend?domain=example.com", app: { db } });
    const out = String(await render({ app } as never, { ctx }));
    assertEquals(out.includes("Check history (2)"), true);
    assertEquals(out.includes("123 ms"), true);

    // grouped facts: every DNS record on its own line, tri-state flags spelled out
    assertEquals(out.includes("<th colspan=2 class=-group>DNS"), true);
    // the raw per-server lines carry the reading, the panel spells out what follows from them
    assertEquals(out.includes("<div>ns1.example.com <small>192.0.2.10 · serial 2024010101</small></div>"), true);
    assertEquals(out.includes("<div>ns2.example.com <small>no answer</small></div>"), true);
    assertEquals(out.includes("<th>NS answering<td>1/2"), true);
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

Deno.test("cms.backend.domain-monitor: hostname and certificate name matching", () => {
  assertEquals(normalizeDomain(" https://Example.COM/path?x=1 "), "example.com");
  assertEquals(normalizeDomain("sub.example.co.uk"), "sub.example.co.uk");
  assertEquals(normalizeDomain("xn--bcher-kva.example"), "xn--bcher-kva.example");
  // not domains: other schemes, credentials, bare hosts and bare addresses
  for (const bad of ["ftp://example.com", "https://user:pw@example.com", "localhost", "192.0.2.1", "", "no dots"]) {
    assertEquals(normalizeDomain(bad), "", bad);
  }
  assertEquals(apex("a.b.example.com"), "example.com");
  assertEquals(apex("example.com"), "example.com");
  assertEquals(wwwAlt("example.com"), "www.example.com");
  assertEquals(wwwAlt("www.example.com"), "example.com");

  assertEquals(covers("example.com", "example.com"), true);
  assertEquals(covers("*.example.com", "www.example.com"), true);
  // a wildcard covers exactly one label — neither the apex itself nor a deeper name
  assertEquals(covers("*.example.com", "example.com"), false);
  assertEquals(covers("*.example.com", "a.b.example.com"), false);
  assertEquals(covers("other.com", "example.com"), false);
});

Deno.test("cms.backend.domain-monitor: SPF and DMARC are read by value, not by presence", () => {
  assertEquals(spf(["v=spf1 include:_spf.example.com -all"]).policy, "-all");
  assertEquals(spf(["v=spf1 ip4:192.0.2.0/24 ~all"]).error, "");
  // a record that lets everyone send, and a pair of records receivers must discard entirely
  assertEquals(spf(["v=spf1 +all"]).error, "+all accepts every sender");
  assertEquals(spf(["v=spf1 -all", "v=spf1 ~all"]).error, "multiple SPF records");
  assertEquals(spf(["v=spf1 ip4:192.0.2.1"]).error, "no all mechanism");
  assertEquals(spf(["some other txt record"]).record, "");

  assertEquals(dmarc(["v=DMARC1; p=reject; rua=mailto:a@b.c"]).policy, "reject");
  assertEquals(dmarc(["v=DMARC1; p=reject; rua=mailto:a@b.c"]).rua, true);
  assertEquals(dmarc(["v=DMARC1; p=none"]).rua, false);
  assertEquals(dmarc(["v=DMARC1; p=quarantine; sp=reject"]).sub, "reject");
  // pct defaults to 100 when unset, and silently exempts the rest of the mail when it is not
  assertEquals(dmarc(["v=DMARC1; p=reject"]).pct, 100);
  assertEquals(dmarc(["v=DMARC1; p=reject; pct=20"]).pct, 20);
  assertEquals(dmarc([]).pct, null);
});

Deno.test("cms.backend.domain-monitor: overview folds column groups per user", async () => {
  const { db, app } = await testApp();
  try {
    await db.table("monitor_domain").insert({ domain: "example.com", created: 1 });
    const overview = async (cols?: string) => {
      const ctx = await testContext({
        url: "http://qino.test/backend",
        app: { db },
        set: { settings: { "cms.backend.domain-monitor": { cols: () => cols } } },
      });
      return String(await render(testNode(app) as never, { ctx }));
    };

    // mail starts folded away — it is the widest, most specialised block
    const fresh = await overview(undefined);
    assertEquals(fresh.includes("-domains -no-mail"), true);
    assertEquals(fresh.includes('data-col="mail" checked'), false);
    assertEquals(fresh.includes('data-col="dns" checked'), true);

    const chosen = await overview("dns,tls");
    assertEquals(chosen.includes("-no-dns"), true);
    assertEquals(chosen.includes("-no-tls"), true);
    assertEquals(chosen.includes("-no-mail"), false);
    // the cells carry their group, the class on the table is what actually hides them
    assertEquals(chosen.includes("data-g=dns"), true);
    assertEquals(chosen.includes("data-g=mail"), true);

    // a stored value that is not a group name must not reach the class attribute
    assertEquals((await overview("mail,<script>")).includes("script"), false);
    assertEquals(ctxSettingsSchema.properties.cols.type, "string");
  } finally {
    await db.close();
  }
});

Deno.test("cms.backend.domain-monitor: row grades TTL, expiry and mail policy", () => {
  const day = 86400;
  const base = { domain: "example.com", checked: 1, online: true, status_code: 200 };
  const cell = (row: Record<string, unknown>) => String(rowHtml({ ...base, ...row } as never, new URL("http://qino.test/cms2/?cmspid=1488&lang=en")));

  // TTLs are graded by the shortest one: a minute is a migration setting, not a resting state
  assertEquals(cell({ dns_ttl: "a=30\nmx=3600" }).includes("var(--red)"), true);
  assertEquals(cell({ dns_ttl: "a=120" }).includes("var(--orange)"), true);
  assertEquals(cell({ dns_ttl: "a=3600\nmx=3600" }).includes("<small>3600s</small>"), true);

  const soon = cell({ reg_expires: Math.floor(Date.now() / 1000) + 5 * day });
  assertEquals(soon.includes("<small>4 d</small>") || soon.includes("<small>5 d</small>"), true);
  assertEquals(cell({ reg_found: false }).includes("<small>gone</small>"), true);

  // presence is not the point: +all and p=none are records that permit everything
  assertEquals(cell({ spf: "v=spf1 +all", spf_policy: "+all", spf_error: "+all accepts every sender" }).includes("var(--red)"), true);
  assertEquals(cell({ spf: "v=spf1 -all", spf_policy: "-all", spf_lookups: 2 }).includes("var(--green)"), true);
  assertEquals(cell({ spf: "v=spf1 -all", spf_policy: "-all", spf_lookups: 12 }).includes("var(--red)"), true);
  assertEquals(cell({ dmarc_policy: "none" }).includes("var(--orange)"), true);
  assertEquals(cell({ dmarc_policy: "reject", dmarc_pct: 10 }).includes("var(--orange)"), true);

  // an unsigned zone is the norm, so it must never be flagged as broken
  assertEquals(cell({ dnssec: false }).includes("not signed"), true);
  assertEquals(cell({ dnssec: null, dns_ds: "2371 13 2 ab" }).includes("no key found in the zone"), true);

  // foreign text stays text, wherever it is put
  const nasty = cell({ spf_policy: "<script>", cert_issuer: "<script>", reg_registrar: "<script>" });
  assertEquals(nasty.includes("<script>"), false);
  assertEquals(nasty.includes("&lt;script&gt;"), true);
});

Deno.test("cms.backend.domain-monitor: a change is what the last check found different", () => {
  const result = { status_code: 200, checked: 1000, dns_a: "192.0.2.1", response_time: 10 };
  // a first check compares against nothing, and the fields that move on their own do not count
  assertEquals(diffResults(undefined, result), []);
  assertEquals(diffResults({ ...result, response_time: 999, cert_days: 3, log_id: 7 }, result), []);
  assertEquals(diffResults({ ...result, dns_a: "192.0.2.2" }, result), [{ key: "dns_a", before: "192.0.2.2", after: "192.0.2.1" }]);

  const day = 86400;
  const now = Math.floor(Date.now() / 1000);
  const base = { domain: "example.com", checked: now, online: true, status_code: 200 };
  const page = new URL("http://qino.test/cms2/?cmspid=1488&lang=en");
  const cell = (changed: number) => String(rowHtml({ ...base, changed, changes: "dns_a" } as never, page));
  assertEquals(cell(now - day / 2).includes("var(--red)"), true);
  assertEquals(cell(now - 3 * day).includes("var(--orange)"), true);
  assertEquals(cell(now - 30 * day).includes("changed: dns_a"), true);
  assertEquals(String(rowHtml(base as never, page)).includes("data-changed data-value=\"0\""), true);
  // the detail link carries the page's own parameters, or it would leave the backend page
  assertEquals(cell(now).includes('href="/cms2/?cmspid=1488&amp;lang=en&amp;domain=example.com"'), true);
});

Deno.test("cms.backend.domain-monitor: an expired certificate reads the same on every check", () => {
  // rustls puts the moment of the check into the message; the same dead cert must not look new
  const message = (now: number, ago: number) =>
    `client error (Connect): invalid peer certificate: certificate expired: verification time ${now} (UNIX), but certificate is not valid after 1619219664 (${ago} seconds ago)`;
  const first = errText(new Error("fetch failed", { cause: new Error(message(1785753422, 166533758)) }));
  assertEquals(first, errText(new Error("fetch failed", { cause: new Error(message(1785755736, 166536072)) })));
  assertEquals(first.includes("not valid after 1619219664"), true); // the cert's own date stays
  assertEquals(diffResults({ status_code: null, checked: 1, error: first }, { status_code: null, checked: 2, error: first }), []);
});

Deno.test("cms.backend.domain-monitor: the dashboard widget lists what changed last", async () => {
  const { db, app } = await testApp();
  try {
    const node = testNode(app) as never;
    await db.table("monitor_domain").insert({ domain: "quiet.example", created: 1 });
    // nothing has ever changed → no card at all
    assertEquals(await inRequest(() => backendDashboardWidget(app, node)), "");

    const now = Math.floor(Date.now() / 1000);
    await db.table("monitor_domain").insert({ domain: "moved.example", created: 1, changed: now, changes: "dns_a" });
    const out = String(await inRequest(() => backendDashboardWidget(app, node)));
    assertEquals(out.includes('href="/cms2/?cmspid=1488&amp;lang=en&amp;domain=moved.example"'), true);
    assertEquals(out.includes("changed: dns_a"), true);
    assertEquals(out.includes("quiet.example"), false);
  } finally {
    await db.close();
  }
});

Deno.test("cms.backend.domain-monitor: pruning keeps the checks that dated a state", async () => {
  const { db, app } = await testApp();
  try {
    const check = async (checked_at: number, result: Record<string, unknown>) =>
      await db.table("monitor_domain_check").insert({
        domain: "example.com",
        checked_at,
        result: JSON.stringify({ status_code: 200, checked: checked_at, ...result }),
      });
    await check(100, { dns_a: "192.0.2.1", response_time: 10 });
    await check(200, { dns_a: "192.0.2.1", response_time: 99 }); // nothing but the timing moved
    await check(300, { dns_a: "192.0.2.2", response_time: 10 }); // the record moved
    await check(400, { dns_a: "192.0.2.2", response_time: 10 });
    await check(500, { dns_a: "192.0.2.2", response_time: 10 });

    // young checks stay whatever they hold, so a cutoff below them all removes nothing
    assertEquals(await pruneHistory(app, { before: 100 }), 0);
    assertEquals(await pruneHistory(app, { before: 450 }), 2);
    assertEquals(await db.col`SELECT checked_at FROM monitor_domain_check ORDER BY id`, [100, 300, 500]);
    // the survivors differ from each other, so a second run has nothing left to do
    assertEquals(await pruneHistory(app, { before: 600 }), 1);
    assertEquals(await db.col`SELECT checked_at FROM monitor_domain_check ORDER BY id`, [100, 300]);
  } finally {
    await db.close();
  }
});

// The api renders rows, and those link back to the page the node sits on — so it needs both a node
// that can name its url and a request to resolve it against.
const testNode = (app: App) => ({ app, url: () => "/cms2/?cmspid=1488&lang=en" });

async function inRequest<T>(fn: () => Promise<T>): Promise<T> {
  const ctx = await testContext({ url: "http://qino.test/cms2/api/cms/node/1488/api" });
  return await requestStorage.run(ctx, fn);
}

// Built from the shipped schema instead of a copy of it — the column list keeps growing and a
// hand-written CREATE TABLE here would quietly drift out of date.
async function testApp(): Promise<{ db: Db; app: App }> {
  const db = new Db("sqlite::memory:");
  await db.migrate(dbSchema, { patch: true });
  db.schema = dbSchema;
  await db.loadTables();
  return { db, app: { db } as unknown as App };
}
