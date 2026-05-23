cms.initCont("cms.backend.api", (el) => {
  const routes = JSON.parse(el.dataset.routes);
  const appURL = el.dataset.appUrl;

  el.querySelector("#api-search")?.addEventListener("input", (e) => {
    const q = e.target.value.toLowerCase();
    el.querySelectorAll(".api-route").forEach((r) => {
      const text = r.querySelector(".api-path").textContent.toLowerCase()
        + " " + r.querySelector(".api-desc").textContent.toLowerCase()
        + " " + r.querySelector(".api-badge").textContent.toLowerCase();
      r.hidden = q && !text.includes(q);
    });
  });

  el.addEventListener("click", async (e) => {
    const head = e.target.closest(".api-route-head");
    if (head) {
      const idx = Number(head.closest(".api-route").dataset.idx);
      const body = el.querySelector("#api-body-" + idx);
      const route = body.closest(".api-route");
      const hidden = body.hidden;
      body.hidden = !hidden;
      route.classList.toggle("open", !hidden);
      return;
    }

    const toolBtn = e.target.closest(".api-tool-btn");
    if (toolBtn) {
      const idx = Number(toolBtn.closest(".api-route").dataset.idx);
      const toolEl = el.querySelector("#api-tool-" + idx);
      toolEl.hidden = !toolEl.hidden;
      return;
    }

    const checkBtn = e.target.closest("[data-check-access]");
    if (checkBtn) {
      const idx = Number(checkBtn.dataset.checkAccess);
      const r = routes[idx];
      const form = checkBtn.closest("form");
      const result = el.querySelector("#api-result-" + idx);
      result.hidden = false;
      result.className = "api-result";
      try {
        let path = r.path;
        for (const p of r.pathParams) {
          const field = form.elements[p];
          if (!field || !field.value) {
            result.textContent = "⚠ fill in path param: " + p;
            result.className = "api-result error";
            return;
          }
          path = path.replace(":" + p, encodeURIComponent(field.value));
        }
        result.textContent = "Checking…";
        const res = await fetch(appURL + "api" + path + "?_checkAccess=1", { method: r.method.toUpperCase(), headers: { "Content-Type": "application/json" } });
        result.textContent = res.ok ? "✓ access granted" : "✗ " + res.status + " access denied";
        if (!res.ok) result.className = "api-result error";
      } catch (err) {
        result.textContent = String(err);
        result.className = "api-result error";
      }
      return;
    }
  });

  el.addEventListener("submit", async (e) => {
    const form = e.target.closest(".api-form");
    if (!form) return;
    e.preventDefault();
    const idx = Number(form.closest(".api-route").dataset.idx);
    const r = routes[idx];
    const result = el.querySelector("#api-result-" + idx);
    result.hidden = false;
    result.textContent = "Loading…";
    result.className = "api-result";

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
      const opts = { method, headers: { "Content-Type": "application/json" } };
      if (isBodyMethod && Object.keys(body).length) opts.body = JSON.stringify(body);

      const res = await fetch(url, opts);
      const text = await res.text();
      let pretty;
      try { pretty = JSON.stringify(JSON.parse(text), null, 2); } catch { pretty = text; }
      result.textContent = res.status + " " + res.statusText + "\n\n" + pretty;
      if (!res.ok) result.className = "api-result error";
    } catch (err) {
      result.textContent = String(err);
      result.className = "api-result error";
    }
  });
});
