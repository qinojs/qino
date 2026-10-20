import { assertEquals, assertStringIncludes } from "@qino/qino/tests";

import { parseCaddy, parseShow, parseSs } from "../host/helper.ts";
import { cms } from "../plugin.ts";
import manifest from "../manifest.json" with { type: "json" };
import { list, renderProjects } from "../render.ts";

import type { App } from "@qino/qino";
import type { Node } from "@qino/qino/cms";
import type { Project } from "../host/helper.ts";

const t = (strings: TemplateStringsArray) => Promise.resolve(strings.join(""));
const app = { t } as unknown as App;

Deno.test("cms.backend.hosting: metadata is wired", () => {
  assertEquals(manifest.name, "cms.backend.hosting");
  assertEquals(manifest.dependencies, ["cms.backend"]);
  assertEquals(typeof cms.node.parts.list, "function");
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

Deno.test("cms.backend.hosting: table flags sockets beside the proxy and escapes", async () => {
  const project = (o: Partial<Project>): Project => ({
    name: "a", state: "active", sub: "running", since: null, restarts: 0, memory: 2048, cpu: 3, tasks: 9,
    disk: null, listen: [], domains: [], ...o,
  });
  const out = String(await renderProjects(app, [
    project({ name: "<b>x", listen: ["127.0.0.1:8091"], domains: ["a.ch"] }),
    project({ name: "b", state: "failed", listen: ["0.0.0.0:8092"] }),
  ]));
  assertStringIncludes(out, "&lt;b&gt;x");
  assertStringIncludes(out, `<code>127.0.0.1:8091</code>`);
  assertStringIncludes(out, `title="Reachable without the proxy">0.0.0.0:8092</span>`);
  assertStringIncludes(out, `href="https://a.ch/"`);
  assertStringIncludes(out, "<u2-bytes>2048</u2-bytes>");
  assertStringIncludes(out, "var(--red)");
});

Deno.test("cms.backend.hosting: a missing helper is a message, not an error", async () => {
  const settings = { "cms.backend.hosting": { socket: "/nonexistent/hosting.sock" } };
  const out = String(await list({ app: { t, settings } } as unknown as Node));
  assertStringIncludes(out, "The hosting helper does not answer (<code>/nonexistent/hosting.sock</code>)");
});
