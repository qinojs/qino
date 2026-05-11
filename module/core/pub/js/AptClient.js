const METHODS = new Set(["get", "post", "put", "delete", "patch"]);

export class AptClient extends EventTarget {
  #base; #handlers = []; #unwrap;
  headers = {};

  constructor(base, { unwrap } = {}) {
    super();
    this.#base = typeof base === "string" ? new URL(base) : base;
    this.#unwrap = unwrap;
    return new Proxy(this, {
      get: (t, key) => key in t || typeof key === "symbol" ? (typeof t[key] === "function" ? t[key].bind(t) : t[key]) : t.#node([key]),
    });
  }

  on(pattern, handler) {
    const parts = pattern.split(" ");
    const hasMethod = parts.length > 1 && parts[0].split("|").every(s => METHODS.has(s.toLowerCase()));
    const [m, path] = hasMethod ? parts : ["*", pattern];
    this.#handlers.push({
      methods: m === "*" ? null : new Set(m.split("|").map(s => s.toUpperCase())),
      pattern: new URLPattern({ pathname: `/${path}` }),
      handler,
    });
    return this;
  }

  off(handler) {
    this.#handlers = this.#handlers.filter(h => h.handler !== handler);
    return this;
  }

  #node(parts) {
    return new Proxy(() => {}, {
      get: (_t, key) =>
        key === "then" ? undefined
        : METHODS.has(key) ? (input = {}, opts = {}) => this.#request(key, parts, input, opts)
        : this.#node([...parts, String(key)]),
      apply: (_t, _this, [arg]) => this.#node([...parts, String(arg)]),
    });
  }

  #request(method, parts, input, opts) {
    const url = new URL(parts.map(encodeURIComponent).join("/"), this.#base);
    method = method.toUpperCase();
    const detail = { method, url, input };
    const init = { method, headers: { accept: "application/json", ...this.headers }, signal: opts.signal };

    if (method === "GET" || method === "DELETE") {
      for (const [k, v] of Object.entries(input || {})) if (v != null) url.searchParams.set(k, v);
    } else {
      init.headers["content-type"] = "application/json";
      init.body = JSON.stringify(input || {});
    }

    this.#emit("start", detail);
    return fetch(url, init).then(async res => {
      if (!res.ok) {
        const text = await res.text();
        let msg; try { msg = JSON.parse(text)?.error; } catch { /* not json */ }
        throw new Error(msg ?? (text || `${res.status} ${res.statusText}`));
      }
      const value = res.status === 204 ? undefined : await res.json();
      const done = { ...detail, status: res.status, value };
      const pathname = "/" + parts.join("/");
      for (const { methods, pattern, handler } of this.#handlers) {
        if (methods?.has(method) === false) continue;
        const match = pattern.exec({ pathname });
        if (match) handler({ ...done, params: match.pathname.groups });
      }
      this.#emit("complete", done);
      return this.#unwrap ? value?.[this.#unwrap] : value;
    }).catch(error => {
      this.#emit(error.name === "AbortError" ? "abort" : "error", { ...detail, error });
      throw error;
    });
  }

  #emit = (type, detail) => this.dispatchEvent(new CustomEvent(type, { detail }));
}
