const aptMethods = new Set(["get", "post", "put", "delete", "patch"]);

export function createAptClient(base = defaultBase()) {
  return proxy([]);

  function proxy(parts) {
    return new Proxy(() => {}, {
      get(_target, key) {
        if (key === "then") return undefined;
        if (aptMethods.has(key)) return (body = {}, options = {}) => request(key, parts, body, options);
        return proxy([...parts, String(key)]);
      },
      apply(_target, _thisArg, args) {
        return proxy([...parts, String(args[0])]);
      },
    });
  }

  function request(method, parts, body, options) {
    const controller = new AbortController();
    const url = new URL(parts.map(encodeURIComponent).join("/"), base);
    const detail = { method: method.toUpperCase(), path: [...parts], url, body };
    const init = {
      method: detail.method,
      headers: { accept: "application/json" },
      signal: options.signal ?? controller.signal,
    };
    if (options.keepalive != null) init.keepalive = options.keepalive;

    if (method === "get" || method === "delete") {
      for (const [key, value] of Object.entries(body ?? {})) {
        if (value != null) url.searchParams.set(key, String(value));
      }
    } else {
      init.headers["content-type"] = "application/json";
      init.body = JSON.stringify(body ?? {});
    }

    emit("start", detail);
    const promise = fetch(url, init).then(async (res) => {
      if (!res.ok) {
        const text = await res.text();
        let msg; try { msg = JSON.parse(text).error; } catch { /* not json */ }
        throw new Error(msg ?? (text || `${res.status} ${res.statusText}`));
      }
      const value = res.status === 204 ? undefined : await res.json();
      emit("complete", { ...detail, status: res.status, value });
      return value;
    }).catch((error) => {
      emit(error.name === "AbortError" ? "abort" : "error", { ...detail, error });
      throw error;
    });
    if (!options.signal) promise.abort = () => controller.abort();
    return promise;
  }
}

function emit(type, detail) {
  globalThis.dispatchEvent?.(new CustomEvent(`apt:${type}`, { detail }));
}

function defaultBase() {
  const el = document.querySelector('script[type="json/c1"]');
  let appURL = globalThis.appURL;
  if (!appURL && el?.textContent) try { appURL = JSON.parse(el.textContent).appURL; } catch { /* not json */ }
  return new URL("api/", location.origin + (appURL ?? "/"));
}

globalThis.apt ??= createAptClient();
