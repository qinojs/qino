// deno-lint-ignore-file no-explicit-any
import { assertEquals, fakeCms } from "@qino/qino/tests";
import { backendDashboardWidget, cms } from "../plugin.ts";
import manifest from "../manifest.json" with { type: "json" };
const { name, dependencies } = manifest;

// Fake tree node: fixed access level + a tiny breadcrumb path (root is filtered out).
function mkNode(id: number, access: number, title: string, parents: any[] = [], type = "p"): any {
  const self: any = {
    id,
    vs: { type },
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

// page 20 (editable, WRITE) below "Section"; content 21 lives on it and inherits
// WRITE; page 30 (no access) must never surface.
function fixture() {
  const section = mkNode(10, 2, "Section");
  const page20 = mkNode(20, 2, "Page 20", [section]);
  const reg: Record<number, any> = {
    10: section,
    20: page20,
    21: mkNode(21, 2, "Body", [section, page20], "c"), // content on page 20
    30: mkNode(30, 0, "Blocked"),
  };
  // newest first; page mutation (node 20) and text mutation (node 21) are two events
  const rows = [
    { id: 5, log_id: 2, node_id: 20, page_id: 20, data: JSON.stringify({ table: "page", op: "update", cols: ["visible"] }), time: 1000, client_id: 7, ip: "1.2.3.4", ua: CHROME, usr_id: 9, email: "a@b.c", firstname: "Al", lastname: "Ice" },
    { id: 4, log_id: 2, node_id: 21, page_id: 20, data: JSON.stringify({ table: "page_text", op: "update", name: "body", lang: "de" }), time: 1000, client_id: 7, ip: "1.2.3.4", ua: CHROME, usr_id: 9, email: "a@b.c", firstname: "Al", lastname: "Ice" },
    { id: 3, log_id: 1, node_id: 30, page_id: 30, data: JSON.stringify({ table: "page_text", op: "update", name: "title" }), time: 900, client_id: 8, ip: "9.9.9.9", ua: "", usr_id: null, email: null, firstname: null, lastname: null },
  ];
  return { rows, reg };
}

const ctx = { clientId: 7, lang: "en", req: { appUrl: "/" } } as any;
const listPart = (node: any, filter: any = {}) => cms.node.parts.history(node, { ctx, vars: { filter } }).then(String);

Deno.test("history: metadata is wired", () => {
  assertEquals(name, "cms.backend.cms.history");
  assertEquals(dependencies, ["cms.backend", "cms"]);
});

Deno.test("history: only pages the caller may edit are listed; one event per request × node", async () => {
  const { rows, reg } = fixture();
  const out = await listPart(host(rows, reg));

  // page mutation (node 20) and text mutation (node 21) are separate events, both on editable page 20
  assertEquals(out.includes(`data-key="2:20"`), true);
  assertEquals(out.includes(`data-key="2:21"`), true);
  assertEquals(out.includes("Visibility changed"), true);
  assertEquals(out.includes(`Text "body" (de) changed`), true);
  assertEquals(out.includes("Al Ice"), true);       // editor
  assertEquals(out.includes("Chrome 120"), true);   // browser from UA
  assertEquals(out.includes("Section"), true);          // breadcrumb ancestor
  assertEquals(out.includes("<b>Page 20</b>"), true);   // the containing page is shown in bold

  // the no-access page (30) leaks nothing — not its change, title, or ip
  assertEquals(out.includes(`Text "title"`), false);
  assertEquals(out.includes("Blocked"), false);
  assertEquals(out.includes("9.9.9.9"), false);
});

Deno.test("history: access is judged on the content node, not just its page", async () => {
  const section = mkNode(10, 2, "Section");
  const page = mkNode(20, 2, "Page 20", [section]);
  const reg: Record<number, any> = {
    10: section,
    20: page,
    21: mkNode(21, 1, "Locked content", [section, page], "c"), // READ-only content on an editable page
    22: mkNode(22, 2, "Open content", [section, page], "c"),   // WRITE content on the same page
  };
  const rows = [
    { id: 5, log_id: 3, node_id: 21, page_id: 20, data: JSON.stringify({ table: "page_text", name: "secret" }), time: 1, usr_id: 9, email: "a@b.c" },
    { id: 4, log_id: 3, node_id: 22, page_id: 20, data: JSON.stringify({ table: "page_text", name: "public" }), time: 1, usr_id: 9, email: "a@b.c" },
  ];
  const out = await listPart(host(rows, reg));
  assertEquals(out.includes(`Text "public"`), true);  // WRITE content → shown
  assertEquals(out.includes(`Text "secret"`), false); // READ-only content → hidden, even though the page is editable
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
  const out = String(await cms.node.render(host(rows, reg), { ctx, vars: {} }));
  for (const col of ["When", "Who", "Where", "What", "Client"]) assertEquals(out.includes(">" + col), true);
  assertEquals(out.includes(`cms-part=history`), true);
  assertEquals(out.includes(`data-key="2:20"`), true); // initial list embedded
});

Deno.test("history widget: latest change per user, newest first, access-filtered", async () => {
  const rows = [ // newest first (node_id == page_id here: page-level changes)
    { id: 9, node_id: 20, page_id: 20, time: 300, usr_id: 1, email: "a@b.c", firstname: "Al", lastname: "Ice" },
    { id: 8, node_id: 30, page_id: 30, time: 250, usr_id: 2, email: "bob@x.y", firstname: "", lastname: "" }, // page 30: no access
    { id: 7, node_id: 20, page_id: 20, time: 200, usr_id: 1, email: "a@b.c", firstname: "Al", lastname: "Ice" }, // older, same user
    { id: 6, node_id: 20, page_id: 20, time: 100, usr_id: 3, email: "cara@x.y", firstname: "Cara", lastname: "" },
  ];
  const access: Record<number, number> = { 20: 2, 30: 0 };
  const app: any = {
    t: (s: TemplateStringsArray) => Promise.resolve(s.join("")),
    db: { query: () => Object.assign(Promise.resolve(rows), { catch: () => Promise.resolve(rows) }) },
  };
  fakeCms(app, {
    node: (id: number) => ({
      id: Number(id),
      access: () => Promise.resolve(access[Number(id)] ?? 0),
      title: () => Promise.resolve({ string: () => Promise.resolve("Page " + id) }),
      url: () => Promise.resolve("/p/" + id),
    }),
  } as never);

  const out = String(await backendDashboardWidget(app));
  assertEquals(out.includes("Al Ice"), true);              // active editor on an editable page
  assertEquals(out.includes("Cara"), true);
  assertEquals(out.includes("bob@x.y"), false);            // only edited a page with no access → hidden
  assertEquals(out.split("Al Ice").length - 1, 1);         // one row per user despite two edits
  assertEquals(out.indexOf("Al Ice") < out.indexOf("Cara"), true); // newest first
});
