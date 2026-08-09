const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const MUTATION = new Set(["POST", "PUT", "PATCH", "DELETE"]);

// probe result → glyph + title; ⊘ keeps the CSRF/origin gate apart from a real access denial
const STATE = {
  ok:       ["✓", "access granted"],
  denied:   ["✗", "access denied (403)"],
  csrf:     ["⊘", "CSRF/origin gate — a mutation needs a bearer identity or the cookie's token, not an access result"],
  notfound: ["404", "no such route, or a path param is missing"],
  param:    ["…", "fill the path param first"],
  err:      ["!", "request error"],
};

// bounded concurrency so a full grid doesn't fire hundreds of requests at once
async function pool(items, limit, fn) {
  const it = items[Symbol.iterator]();
  await Promise.all(Array.from({ length: limit }, async () => {
    for (let n = it.next(); !n.done; n = it.next()) await fn(n.value);
  }));
}

cms.initNode("cont.apitest", (root) => {
  const appUrl = root.dataset.appUrl;
  const csrf = globalThis.qino?.csrfToken;
  const rows = [...root.querySelectorAll("tbody tr[data-method]")];
  let seq = 0;
  const identities = [
    { id: "anon", label: "anonymous", mode: "anon" },
    { id: "cookie", label: "current session", mode: "cookie" },
  ];
  const byId = (id) => identities.find((i) => i.id === id);
  const visible = () => rows.filter((tr) => !tr.hidden);

  function renderIdentities() {
    root.querySelector(".-identities").innerHTML = identities.map((i) =>
      `<span class="-chip -m-${i.mode}">${esc(i.label)}${i.mode === "bearer" ? ` <button data-rm="${i.id}" title="remove">✕</button>` : ""}</span>`
    ).join("");
    root.querySelector("thead .-cells").innerHTML = identities.map((i) =>
      `<span class="-idcol" data-col="${i.id}" title="re-check this identity">${esc(i.label)}</span>`
    ).join("");
    for (const tr of rows) {
      tr.querySelector(".-cells").innerHTML = identities.map((i) => `<button class="-cell" data-col="${i.id}">·</button>`).join("");
    }
  }

  function resolvePath(tr) {
    let path = tr.dataset.path;
    for (const inp of tr.querySelectorAll("[data-param]")) {
      if (!inp.value) return null;
      path = path.replace(":" + inp.dataset.param + "*", encodeURIComponent(inp.value)).replace(":" + inp.dataset.param, encodeURIComponent(inp.value));
    }
    return path;
  }

  async function probe(tr, identity) {
    const path = resolvePath(tr);
    if (path === null) return "param";
    const method = tr.dataset.method.toUpperCase();
    const headers = {}, opts = { method, headers };
    if (identity.mode !== "cookie") {
      opts.credentials = "omit"; // drop the ambient cookie so anon/bearer are honest
      if (identity.mode === "bearer") headers["Authorization"] = "Bearer " + identity.token;
    } else if (MUTATION.has(method) && csrf) headers["X-CSRF-Token"] = csrf;
    headers["X-Api-Check"] = "access";
    try {
      const res = await fetch(appUrl + "api" + path, opts);
      if (res.ok) return "ok";
      const err = await res.json().then((b) => b.error).catch(() => "");
      if (res.status === 403) return err === "Forbidden" ? "csrf" : "denied";
      if (res.status === 404) return "notfound";
      return "err";
    } catch { return "err"; }
  }

  async function check(cell) {
    const identity = byId(cell.dataset.col);
    if (!identity) return;
    const state = await probe(cell.closest("tr"), identity);
    [cell.textContent, cell.title] = STATE[state];
    cell.className = "-cell -s-" + state;
  }

  const checkCells = (cells) => pool(cells, 6, check);
  const checkAll = () => checkCells(visible().flatMap((tr) => [...tr.querySelectorAll(".-cell")]));

  root.querySelector(".-add").addEventListener("submit", (e) => {
    e.preventDefault();
    const token = e.target.querySelector("[data-token]").value.trim();
    if (!token) return;
    const label = e.target.querySelector("[data-label]").value.trim() || token.slice(0, 8) + "…";
    identities.push({ id: "b" + ++seq, label, mode: "bearer", token });
    e.target.reset();
    renderIdentities();
    checkAll();
  });

  root.querySelector(".-identities").addEventListener("click", (e) => {
    const rm = e.target.closest("[data-rm]");
    if (!rm) return;
    identities.splice(identities.findIndex((i) => i.id === rm.dataset.rm), 1);
    renderIdentities();
    checkAll();
  });

  root.querySelector("thead").addEventListener("click", (e) => {
    const col = e.target.closest(".-idcol");
    if (col) checkCells(visible().map((tr) => tr.querySelector(`.-cell[data-col="${col.dataset.col}"]`)));
  });

  root.querySelector("tbody").addEventListener("click", (e) => {
    const cell = e.target.closest(".-cell");
    if (cell) return check(cell);
    const g = e.target.closest("[data-gtoggle]");
    if (g) {
      const collapsed = g.parentElement.parentElement.classList.toggle("-collapsed");
      g.textContent = collapsed ? "▸" : "▾";
      const name = g.closest(".-group").dataset.group;
      for (const tr of rows) if (tr.dataset.group === name) tr.hidden = collapsed;
    }
  });

  // re-check a row when its path param changes
  root.querySelector("tbody").addEventListener("change", (e) => {
    if (e.target.matches("[data-param]")) checkCells([...e.target.closest("tr").querySelectorAll(".-cell")]);
  });

  root.querySelector(".-filter").addEventListener("input", (e) => {
    const q = e.target.value.toLowerCase();
    for (const tr of rows) tr.hidden = q && !(tr.dataset.path + " " + tr.dataset.method + " " + (tr.querySelector(".-desc")?.textContent ?? "")).toLowerCase().includes(q);
    for (const gh of root.querySelectorAll(".-group")) gh.hidden = q && !rows.some((tr) => tr.dataset.group === gh.dataset.group && !tr.hidden);
  });

  renderIdentities();
  checkAll(); // self-filling: the grid lights up on load
});
