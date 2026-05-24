const apiHeaders = (method = "POST") =>
  ({ "Content-Type": "application/json", ...(method === "GET" || !globalThis.qgToken ? {} : { "X-CSRF-Token": globalThis.qgToken }) });

cms.initCont("cms.backend.api", (el) => {
  const routes = JSON.parse(el.dataset.routes);
  const appURL = el.dataset.appUrl;

  el.querySelector("#api-search")?.addEventListener("input", (e) => {
    const q = e.target.value.toLowerCase();
    el.querySelectorAll(".-route").forEach((r) => {
      const text = r.querySelector(".-path").textContent.toLowerCase()
        + " " + r.querySelector(".-desc").textContent.toLowerCase()
        + " " + r.querySelector(".-method").textContent.toLowerCase();
      r.hidden = q && !text.includes(q);
    });
  });

  el.addEventListener("click", async (e) => {
    const checkBtn = e.target.closest("[data-check-access]");
    if (checkBtn) {
      const idx = Number(checkBtn.dataset.checkAccess);
      const r = routes[idx];
      const form = checkBtn.closest("form");
      const result = el.querySelector("#api-result-" + idx);
      try {
        let path = r.path;
        for (const p of r.pathParams) {
          const field = form.elements[p];
          if (!field || !field.value) {
            result.value ="⚠ fill in path param: " + p;
            return;
          }
          path = path.replace(":" + p, encodeURIComponent(field.value));
        }
        result.value ="Checking…";
        const method = r.method.toUpperCase();
        const res = await fetch(appURL + "api" + path + "?_checkAccess=1", { method, headers: apiHeaders(method) });
        result.value =res.ok ? "✓ access granted" : "✗ " + res.status + " access denied";
      } catch (err) {
        result.value =String(err);
      }
      return;
    }
  });

  el.addEventListener("submit", async (e) => {
    const form = e.target.closest(".-form");
    if (!form) return;
    e.preventDefault();
    const idx = Number(form.closest(".-route").dataset.idx);
    const r = routes[idx];
    const result = el.querySelector("#api-result-" + idx);
    result.value ="Loading…";

    try {
      let path = r.path;
      const body = {};
      const query = {};

      for (const field of form.elements) {
        if (!field.name) continue;
        let val = field.value;
        if (val === "") continue;
        if (field.tagName === "SELECT" && val === "") continue;
        if (val === "true") val = true;
        else if (val === "false") val = false;
        else if (!isNaN(val) && val !== "") val = Number(val);

        if (r.pathParams.includes(field.name)) {
          path = path.replace(":" + field.name, encodeURIComponent(val));
        } else if (r.hasQuery && !r.hasInput) {
          query[field.name] = val;
        } else {
          body[field.name] = val;
        }
      }

      const method = r.method.toUpperCase();
      const isBodyMethod = ["POST", "PUT", "PATCH"].includes(method);
      const qs = !isBodyMethod && Object.keys(body).length
        ? "?" + new URLSearchParams(Object.entries(body).map(([k, v]) => [k, String(v)])).toString()
        : Object.keys(query).length
        ? "?" + new URLSearchParams(Object.entries(query).map(([k, v]) => [k, String(v)])).toString()
        : "";
      const url = appURL + "api" + path + qs;
      const opts = { method, headers: apiHeaders(method) };
      if (isBodyMethod && Object.keys(body).length) opts.body = JSON.stringify(body);

      const res = await fetch(url, opts);
      const text = await res.text();
      let pretty;
      try { pretty = JSON.stringify(JSON.parse(text), null, 2); } catch { pretty = text; }
      result.value =res.status + " " + res.statusText + "\n\n" + pretty;
    } catch (err) {
      result.value =String(err);
    }
  });
});
