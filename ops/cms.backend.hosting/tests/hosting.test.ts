import { assertEquals, assertStringIncludes } from "@qino/qino/tests";

import { addresses, fill, freePort, parseCaddy, parseMeminfo, parseShow, parseSs } from "../host/helper.ts";
import { cms } from "../plugin.ts";
import manifest from "../manifest.json" with { type: "json" };
import { list, renderList } from "../render.ts";

import type { App } from "@qino/qino";
import type { Node } from "@qino/qino/cms";
import type { List, Project } from "../host/helper.ts";

const t = (strings: TemplateStringsArray) => Promise.resolve(strings.join(""));
const app = { t } as unknown as App;

Deno.test("cms.backend.hosting: metadata is wired", () => {
  assertEquals(manifest.name, "cms.backend.hosting");
  assertEquals(manifest.dependencies, ["cms.backend"]);
  assertEquals(typeof cms.node.parts.list, "function");
  assertEquals(typeof cms.node.api, "function");
});

Deno.test("cms.backend.hosting: systemctl show blocks", () => {
  const units = parseShow("Id=a.service\nActiveState=active\nMemoryCurrent=1024\n\nId=b.service\nActiveState=failed\nMemoryCurrent=[not set]\n");
  assertEquals(units.map((u) => [u.Id, u.ActiveState, u.MemoryCurrent]), [
    ["a.service", "active", "1024"],
    ["b.service", "failed", "[not set]"],
  ]);
});

Deno.test("cms.backend.hosting: caddy sites, ports, snippets and comments", () => {
  const sites = parseCaddy(`
(www) {
  redir https://{args[0]}{uri}
}
# a comment {
a.ch, b.ch {
    header -Via
    reverse_proxy 127.0.0.1:8091 # main
    handle /x {
        reverse_proxy localhost:8092
    }
}
c.ch {
    reverse_proxy 127.0.0.1:8093 {
        header_up Host {host}
    }
}`);
  assertEquals(sites, [
    { domains: ["a.ch", "b.ch"], ports: [8091, 8092] },
    { domains: ["c.ch"], ports: [8093] },
  ]);
});

Deno.test("cms.backend.hosting: listening sockets by unit", async () => {
  const ss = `LISTEN 0 511 127.0.0.1:8091 0.0.0.0:* users:(("deno",pid=10,fd=12))
LISTEN 0 511 0.0.0.0:8092 0.0.0.0:* users:(("node",pid=20,fd=3))
LISTEN 0 4096 0.0.0.0:22 0.0.0.0:* users:(("sshd",pid=1,fd=3))`;
  const units: Record<number, string> = { 10: "a.service", 20: "b.service" };
  const listen = await parseSs(ss, (pid) => Promise.resolve(units[pid]));
  assertEquals([...listen], [["a.service", ["127.0.0.1:8091"]], ["b.service", ["0.0.0.0:8092"]]]);
});

const server = (o: Partial<List["server"]> = {}): List["server"] => ({
  memory: { total: 8e9, available: 6e9 }, disk: { total: 100e9, available: 40e9 }, cpus: 4, load: [0.5, 0.25, 0.125],
  self: "ops.example", templates: ["qino"], ...o,
});
const project = (o: Partial<Project>): Project => ({
  name: "a", state: "active", sub: "running", since: null, restarts: 0, memory: 2048, cpu: 3, tasks: 9,
  disk: null, listen: [], domains: [], ...o,
});

Deno.test("cms.backend.hosting: table flags sockets beside the proxy and escapes", async () => {
  const out = String(await renderList(app, { server: server(), projects: [
    project({ name: "<b>x", listen: ["127.0.0.1:8091"], domains: ["a.ch"] }),
    project({ name: "b", state: "failed", listen: ["0.0.0.0:8092"] }),
  ] }));
  assertStringIncludes(out, "&lt;b&gt;x");
  assertStringIncludes(out, `<code>127.0.0.1:8091</code>`);
  assertStringIncludes(out, `title="Reachable without the proxy">0.0.0.0:8092</span>`);
  assertStringIncludes(out, `href="https://a.ch/"`);
  assertStringIncludes(out, "<u2-bytes>2048</u2-bytes>");
  assertStringIncludes(out, "var(--red)");
});

Deno.test("cms.backend.hosting: totals, server capacity, actions by state, never on itself", async () => {
  const out = String(await renderList(app, { server: server(), projects: [
    project({ name: "a", memory: 1000, disk: 10, cpu: 2, tasks: 3 }),
    project({ name: "b", state: "inactive", memory: null, disk: 20, cpu: null, tasks: null }),
    project({ name: "ops.example", memory: 500, disk: 5 }),
  ] }));
  assertStringIncludes(out, "<td class=-num><u2-bytes>1500</u2-bytes>"); // memory of all projects
  assertStringIncludes(out, "<td class=-num><u2-bytes>2000000000</u2-bytes>"); // memory used on the server
  assertStringIncludes(out, "<td class=-num><u2-bytes>60000000000</u2-bytes>"); // disk used
  assertStringIncludes(out, "<td class=-num><u2-bytes>35</u2-bytes>"); // disk of all projects
  assertStringIncludes(out, "4 cores");
  assertStringIncludes(out, `data-verb=stop data-name="a"`);
  assertStringIncludes(out, `data-verb=start data-name="b"`);
  assertEquals(out.includes(`data-verb=stop data-name="b"`), false);
  assertEquals(/data-verb=(stop|restart|delete) data-name="ops.example"/.test(out), false);
  assertStringIncludes(out, `data-verb=log data-name="ops.example"`);
  assertStringIncludes(out, "<option>qino</option>");
});

Deno.test("cms.backend.hosting: templates, ports and memory", () => {
  assertEquals(fill("{{domain}}:{{port}} {{other}}", { domain: "a.ch", port: "8097" }), "a.ch:8097 {{other}}");
  assertEquals(freePort(new Set([8090, 8091, 8093])), 8092);
  assertEquals(addresses("a.ch", "preview.s4.example.ch"), ["a.ch", "a.ch.preview.s4.example.ch"]);
  assertEquals(addresses("x.s4.example.ch", "preview.s4.example.ch"), ["x.s4.example.ch"]);
  assertEquals(addresses("a.ch", ""), ["a.ch"]);
  assertEquals(freePort(new Set(), [9000, 9000]), 9000);
  assertEquals(parseMeminfo("MemTotal:       8000 kB\nMemFree:  10 kB\nMemAvailable:   6000 kB\n"), { total: 8192000, available: 6144000 });
});

Deno.test("cms.backend.hosting: a missing helper is a message, not an error", async () => {
  const settings = { "cms.backend.hosting": { socket: "/nonexistent/hosting.sock" } };
  const out = String(await list({ app: { t, settings } } as unknown as Node));
  assertStringIncludes(out, "The hosting helper does not answer (<code>/nonexistent/hosting.sock</code>)");
});
