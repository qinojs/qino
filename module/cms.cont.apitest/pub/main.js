const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const MUTATION = new Set(["POST", "PUT", "PATCH", "DELETE"]);

// probe result → glyph + title; distinct states keep the CSRF/origin gate apart from a real access denial
const STATES = {
  ok:       { glyph: "✓",   title: "access granted" },
  denied:   { glyph: "✗",   title: "access denied (403)" },
  csrf:     { glyph: "⊘",   title: "CSRF/origin gate — mutation needs a token (cookie) or bearer identity, not an access result" },
  notfound: { glyph: "404", title: "no such route, or path param missing" },
  param:    { glyph: "…",   title: "fill the path param first" },
  err:      { glyph: "!",   title: "request error" },
  pending:  { glyph: "·",   title: "click to check" },
};

// small concurrency pool so "check all" doesn't fire hundreds of requests at once
async function pool(items, limit, fn) {
  const it = items[Symbol.iterator]();
  const workers = Array.from({ length: limit }, async () => {
    for (let n = it.next(); !n.done; n = it.next()) await fn(n.value);
  });
  await Promise.all(workers);
}

cms.initNode("cont.apitest", (root) => {
  const appURL = root.dataset.appUrl;
  const csrf = globalThis.qino?.csrfToken;
  const idBar = root.querySelector(".-identities");
  const headCells = root.querySelector("thead .-cells");
  const bodyRows = [...root.querySelectorAll("tbody tr[data-idx]")];

  let seq = 0;
  const identities = [
    { id: "anon", label: "anonymous", mode: "anon" },
    { id: "cookie", label: "current session", mode: "cookie" },
  ];

  // --- identity column build-out ---------------------------------------------
  function renderIdentities() {
    idBar.innerHTML = identities.map((i) =>
      `<span class="-chip -m-${i.mode}">${esc(i.label)}${i.mode === "bearer" ? ` <button data-rm="${i.id}" title="remove">✕</button>` : ""}</span>`
    ).join("");
    headCells.innerHTML = identities.map((i) =>
      `<span class="-idcol" data-col="${i.id}" title="check this identity for all visible routes">${esc(i.label)}</span>`
    ).join("");
    for (const tr of bodyRows) {
      tr.querySelector(".-cells").innerHTML = identities.map((i) =>
        `<button class="-cell" data-col="${i.id}" title="click to check">${STATES.pending.glyph}</button>`
      ).join("");
    }
    for (const sel of root.querySelectorAll("select[data-as]")) {
      sel.innerHTML = identities.map((i) => `<option value="${i.id}">${esc(i.label)}</option>`).join("");
    }
  }

  const byId = (col) => identities.find((i) => i.id === col);

  // --- access probe (side-effect free via ?_checkAccess=1) --------------------
  function resolvePath(tr) {
    let path = tr.dataset.path;
    for (const inp of tr.querySelectorAll("[data-param]")) {
      if (!inp.value) return null; // missing param → not probeable yet
      const p = inp.dataset.param;
      path = path.replace(":" + p + "*", encodeURIComponent(inp.value)).replace(":" + p, encodeURIComponent(inp.value));
    }
    return path;
  }

  async function probe(tr, identity) {
    const path = resolvePath(tr);
    if (path === null) return "param";
    const method = tr.dataset.method.toUpperCase();
    const headers = {};
    const opts = { method, headers };
    if (identity.mode === "cookie") {
      if (MUTATION.has(method) && csrf) headers["X-CSRF-Token"] = csrf;
    } else {
      opts.credentials = "omit"; // drop the ambient cookie so anon/bearer are honest
      if (identity.mode === "bearer") headers["Authorization"] = "Bearer " + identity.token;
    }
    try {
      const res = await fetch(appURL + "api" + path + "?_checkAccess=1", opts);
      if (res.ok) return "ok";
      let err = "";
      try { err = (await res.json()).error || ""; } catch { /* non-json */ }
      if (res.status === 403) return err === "Forbidden" ? "csrf" : "denied";
      if (res.status === 404) return "notfound";
      return "err";
    } catch { return "err"; }
  }

  function paint(cell, state) {
    const s = STATES[state] ?? STATES.err;
    cell.textContent = s.glyph;
    cell.title = s.title;
    cell.className = "-cell -s-" + state;
  }

  async function checkCell(cell) {
    const tr = cell.closest("tr");
    const identity = byId(cell.dataset.col);
    if (!identity) return;
    cell.textContent = "…";
    paint(cell, await probe(tr, identity));
    cell.dataset.checked = "1";
  }

  const visibleRows = () => bodyRows.filter((tr) => !tr.hidden);

  // --- events ----------------------------------------------------------------
  root.querySelector(".-add").addEventListener("submit", (e) => {
    e.preventDefault();
    const form = e.target;
    const token = form.querySelector("[data-token]").value.trim();
    const label = form.querySelector("[data-label]").value.trim() || (token ? token.slice(0, 8) + "…" : "");
    if (!token) { form.querySelector("[data-token]").focus(); return; }
    identities.push({ id: "b" + ++seq, label, mode: "bearer", token });
    form.reset();
    renderIdentities();
  });

  idBar.addEventListener("click", (e) => {
    const rm = e.target.closest("[data-rm]");
    if (!rm) return;
    const i = identities.findIndex((x) => x.id === rm.dataset.rm);
    if (i >= 0) identities.splice(i, 1);
    renderIdentities();
  });

  headCells.addEventListener("click", (e) => {
    const col = e.target.closest(".-idcol");
    if (!col) return;
    pool(visibleRows().map((tr) => tr.querySelector(`.-cell[data-col="${col.dataset.col}"]`)).filter(Boolean), 6, checkCell);
  });

  root.querySelector("[data-checkall]").addEventListener("click", () => {
    const cells = visibleRows().flatMap((tr) => [...tr.querySelectorAll(".-cell")]);
    pool(cells, 6, checkCell);
  });

  root.querySelector(".-filter").addEventListener("input", (e) => {
    const q = e.target.value.toLowerCase();
    for (const tr of bodyRows) {
      const text = (tr.dataset.path + " " + tr.dataset.method + " " + (tr.querySelector(".-desc")?.textContent ?? "")).toLowerCase();
      tr.hidden = q && !text.includes(q);
      tr.nextElementSibling?.classList.contains("-detail") && (tr.nextElementSibling.hidden = true);
    }
  });

  root.querySelector("tbody").addEventListener("click", (e) => {
    const cell = e.target.closest(".-cell");
    if (cell) return checkCell(cell);
    const toggle = e.target.closest("[data-toggle]");
    if (toggle) {
      const detail = toggle.closest("tr").nextElementSibling;
      detail.hidden = !detail.hidden;
      return;
    }
    const gtoggle = e.target.closest("[data-gtoggle]");
    if (gtoggle) {
      const g = gtoggle.closest(".-group");
      const collapsed = g.classList.toggle("-collapsed");
      gtoggle.textContent = collapsed ? "▸" : "▾";
      for (const tr of bodyRows) if (tr.dataset.group === g.dataset.group) tr.hidden = collapsed;
    }
  });

  // re-probe a row's cells when a path param changes
  root.querySelector("tbody").addEventListener("change", (e) => {
    if (!e.target.matches("[data-param]")) return;
    const cells = [...e.target.closest("tr").querySelectorAll(".-cell")].filter((c) => c.dataset.checked);
    // only refresh cells that were already checked, so we don't spam untouched ones
    pool(cells, 6, checkCell);
  });

  // --- real call (run panel) -------------------------------------------------
  root.querySelector("tbody").addEventListener("submit", async (e) => {
    e.preventDefault();
    const form = e.target;
    const routeTr = form.closest(".-detail").previousElementSibling;
    const out = form.parentElement.querySelector("[data-result]");
    const identity = byId(form.querySelector("[data-as]").value);
    const method = routeTr.dataset.method.toUpperCase();

    const path = resolvePath(routeTr);
    if (path === null) { out.value = "fill the path param(s) first"; return; }

    const body = {}, query = {};
    for (const section of form.querySelectorAll(".-section")) {
      const target = section.dataset.part === "query" ? query : body;
      for (const field of section.querySelectorAll("[name]")) {
        let v = field.value;
        if (v === "") continue;
        if (v === "true") v = true; else if (v === "false") v = false; else if (!isNaN(v)) v = Number(v);
        target[field.name] = v;
      }
    }

    const headers = { "Content-Type": "application/json" };
    const opts = { method, headers };
    if (identity.mode === "cookie") {
      if (MUTATION.has(method) && csrf) headers["X-CSRF-Token"] = csrf;
    } else {
      opts.credentials = "omit";
      if (identity.mode === "bearer") headers["Authorization"] = "Bearer " + identity.token;
    }
    const isBody = MUTATION.has(method);
    const params = isBody ? query : { ...body, ...query };
    const qs = Object.keys(params).length ? "?" + new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)])) : "";
    if (isBody && Object.keys(body).length) opts.body = JSON.stringify(body);

    out.value = "…";
    try {
      const res = await fetch(appURL + "api" + path + qs, opts);
      const text = await res.text();
      let pretty; try { pretty = JSON.stringify(JSON.parse(text), null, 2); } catch { pretty = text; }
      out.value = res.status + " " + res.statusText + "\n\n" + pretty;
    } catch (err) { out.value = String(err); }
  });

  renderIdentities();
});
