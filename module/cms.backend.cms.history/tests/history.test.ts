// deno-lint-ignore-file no-explicit-any
import { assertEquals } from "../../core/tests/deps.ts";
import { cms, name, needs } from "../plugin.ts";

// Fake tree node: fixed access level + a tiny breadcrumb path (root is filtered out).
function mkNode(id: number, access: number, title: string, parents: any[] = []): any {
  const self: any = {
    id,
    access: () => Promise.resolve(access),
    title: () => Promise.resolve({ string: () => Promise.resolve(title) }),
    url: () => Promise.resolve("/p/" + id),
    path: () => Promise.resolve(new Map([...parents, self].map((n) => [n.id, n]))),
  };
  return self;
}

// Host node exposing app.t / app.db.query (returns the given candidate rows) and cms.node().
function host(rows: any[], reg: Record<number, any>): any {
  return {
    app: {
      t: (s: TemplateStringsArray) => Promise.resolve(s.join("")),
      db: { query: () => Object.assign(Promise.resolve(rows), { catch: () => Promise.resolve(rows) }) },
    },
    cms: { node: (id: number) => reg[Number(id)] ?? mkNode(Number(id), 0, "#" + id) },
  };
}

const CHROME = "Mozilla/5.0 Chrome/120.0 Safari/537.36";

// page 20 (editable, WRITE) below "Section"; page 30 (no access) must never surface.
function fixture() {
  const section = mkNode(10, 2, "Section");
  const reg: Record<number, any> = {
    10: section,
    20: mkNode(20, 2, "Page 20", [section]),
    30: mkNode(30, 0, "Blocked"),
  };
  // newest first; the two page-20 rows share one request (log 2) → one event
  const rows = [
    { id: 5, log_id: 2, node_id: 20, page_id: 20, data: JSON.stringify({ table: "page", op: "update", cols: ["visible"] }), time: 1000, client_id: 7, ip: "1.2.3.4", ua: CHROME, usr_id: 9, email: "a@b.c", firstname: "Al", lastname: "Ice" },
    { id: 4, log_id: 2, node_id: 21, page_id: 20, data: JSON.stringify({ table: "page_text", op: "update", name: "body", lang: "de" }), time: 1000, client_id: 7, ip: "1.2.3.4", ua: CHROME, usr_id: 9, email: "a@b.c", firstname: "Al", lastname: "Ice" },
    { id: 3, log_id: 1, node_id: 30, page_id: 30, data: JSON.stringify({ table: "page_text", op: "update", name: "title" }), time: 900, client_id: 8, ip: "9.9.9.9", ua: "", usr_id: null, email: null, firstname: null, lastname: null },
  ];
  return { rows, reg };
}

const listPart = (node: any, filter: any = {}) => cms.node.parts.history(node, { ctx: { clientId: 7 } as any, vars: { filter } }).then(String);

Deno.test("history: metadata is wired", () => {
  assertEquals(name, "cms.backend.cms.history");
  assertEquals(needs, ["cms.backend", "cms"]);
});

Deno.test("history: only pages the caller may edit are listed; a request+page is one event", async () => {
  const { rows, reg } = fixture();
  const out = await listPart(host(rows, reg));

  // one grouped event for the editable page, with both changes described
  assertEquals(out.includes(`data-key="2:20"`), true);
  assertEquals(out.includes("Visibility changed"), true);
  assertEquals(out.includes(`Text "body" (de) changed`), true);
  assertEquals(out.includes("Al Ice"), true);       // editor
  assertEquals(out.includes("Chrome 120"), true);   // browser from UA
  assertEquals(out.includes("Section"), true);      // breadcrumb
  assertEquals(out.includes("Page 20"), true);

  // the no-access page (30) leaks nothing — not its change, title, or ip
  assertEquals(out.includes(`Text "title"`), false);
  assertEquals(out.includes("Blocked"), false);
  assertEquals(out.includes("9.9.9.9"), false);
});

Deno.test("history: type filter keeps only matching mutations", async () => {
  const { rows, reg } = fixture();
  const out = await listPart(host(rows, reg), { type: "text" });
  assertEquals(out.includes(`Text "body" (de) changed`), true);
  assertEquals(out.includes("Visibility changed"), false); // the page mutation is filtered out
});

Deno.test("history: empty result renders the placeholder", async () => {
  const out = await listPart(host([], {}));
  assertEquals(out.includes("No changes found."), true);
  assertEquals(out.includes("data-key"), false);
});

Deno.test("history: render wires the toolbar and column headers around the list", async () => {
  const { rows, reg } = fixture();
  const out = String(await cms.node.render(host(rows, reg), { ctx: { clientId: 7 } as any, vars: {} }));
  for (const col of ["When", "Who", "Where", "What", "Client"]) assertEquals(out.includes(">" + col), true);
  assertEquals(out.includes(`cms-part=history`), true);
  assertEquals(out.includes(`data-key="2:20"`), true); // initial list embedded
});
