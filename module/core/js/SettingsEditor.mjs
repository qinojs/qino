import { createAptClient } from "./apt-client.mjs";

const opened = new Set();
const itemJsBase = "https://cdn.jsdelivr.net/gh/nuxodin/item.js@0.5.0/";
const itemJs = import(itemJsBase + "item.js").catch((err) => {
  console.warn("settings-editor: item.js unavailable", err);
  return null;
});
const itemJsHtmlRenderer = import(itemJsBase + "tools/schema/render/html.js")
  .then((mod) => mod.toInput)
  .catch((err) => {
    console.warn("settings-editor: item.js html renderer unavailable, using fallback", err);
    return null;
  });

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"]/g, (char) => htmlEscapes[char]);
}

const htmlEscapes = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };

function splitPath(path) {
  return Array.isArray(path)
    ? path.filter((key) => typeof key === "string" && key)
    : [];
}

function normalizeSource(source) {
  if (!source || typeof source !== "object") {
    throw new Error("Invalid settings source");
  }
  const path = splitPath(source.path);
  if (source.kind === "node" || source.kind === "page") {
    const id = parseInt(String(source.id ?? ""), 10);
    if (!id) throw new Error("Missing node settings source id");
    return { kind: "node", id, path };
  }
  if (source.kind === "app" || source.kind === "ctx") {
    return { kind: source.kind, path };
  }
  throw new Error(`Unknown settings source "${String(source.kind)}"`);
}

function joinPath(parts) {
  return splitPath(parts).join("/");
}

const apt = globalThis.apt ?? createAptClient();

function settingsApi(source, schema = false) {
  const name = schema ? "settings-schema" : "settings";
  if (source.kind === "app") return apt.core[name];
  if (source.kind === "ctx") return apt.core[`ctx-${name}`];
  return apt.cms.node(source.id)[name];
}

async function apiGet(source, path, schema = false) {
  const fullPath = joinPath([...splitPath(source.path), ...splitPath(path)]);
  const body = fullPath ? { path: fullPath } : {};
  return await settingsApi(source, schema).get(body);
}

async function apiWrite(method, source, path, value) {
  const body = {
    path: joinPath([...splitPath(source.path), ...splitPath(path)]),
    value,
  };
  const write = method === "DELETE" ? "delete" : method.toLowerCase();
  return await settingsApi(source)[write](body);
}

async function settingsItem(data, schema) {
  const mod = await itemJs;
  if (!mod) return null;
  const root = mod.item(data ?? {});
  root.setSchema(schema ?? {});
  return root;
}

async function inputHtml(schema, value, path) {
  const toInput = await itemJsHtmlRenderer;
  if (toInput) {
    return toInput(schema ?? {}, {
      value,
      name: JSON.stringify(path),
    });
  }
  return fallbackInputHtml(schema, value, path);
}

function fallbackInputHtml(schema, value, path) {
  const name = escapeHtml(JSON.stringify(path));
  const type = schema?.type ?? "";
  if (type === "boolean") {
    return `<input type="checkbox" name="${name}"${value ? " checked" : ""}>`;
  }
  if (Array.isArray(schema?.enum)) {
    const options = schema.enum.map((option) => {
      const selected = String(option) === String(value ?? "") ? " selected" : "";
      return `<option value="${escapeHtml(option)}"${selected}>${escapeHtml(option)}`;
    }).join("");
    return `<select name="${name}">${options}</select>`;
  }
  if (type === "integer" || type === "number") {
    return `<input type="number" name="${name}" value="${escapeHtml(value ?? "")}">`;
  }
  const str = String(value ?? "");
  if (str.includes("\n")) {
    return `<textarea name="${name}">${escapeHtml(str)}</textarea>`;
  }
  return `<input type="text" name="${name}" value="${escapeHtml(str)}">`;
}

async function renderItems(item) {
  const schema = item.schema ?? {};
  const keys = [...new Set([...Object.keys(schema.properties ?? {}), ...item.keys])]
    .filter((key) => key && key[0] !== "_");
  if (!keys.length) return "";

  const children = keys.map((key) => item.item(key));
  const hasSub = children.some(isObjectItem);
  let html = `<ul${hasSub ? " class=-hasSub" : ""}>`;
  for (const child of children) {
    const cs = child.schema ?? {};
    const objectNode = isObjectItem(child);
    const id = JSON.stringify(child.path);
    const isOpen = opened.has(id);
    const title = typeof cs.description === "string" && cs.description
      ? ` title="${escapeHtml(cs.description)}"`
      : "";

    html += "<li>";
    html += `<span class=-row data-path="${escapeHtml(id)}">`;
    html += "<span class=-toggle>";
    html += objectNode
      ? `<a class="toggle -${isOpen ? "minus" : "plus"}"></a>`
      : "<a class=toggle></a>";
    html += "</span>";
    html += `<span class=-name${title}>${escapeHtml(child.key)}</span>`;
    html += "<span class=-inp>";
    html += objectNode
      ? `<input type="hidden" name="${escapeHtml(id)}">`
      : await inputHtml(cs, child.get({ silent: true }), child.path);
    html += "</span>";
    html += `<span class=-rem><a>x</a></span>`;
    html += "</span>";
    if (objectNode && isOpen) html += await renderItems(child);
  }
  html += "</ul>";
  return html;
}

function isObjectItem(item) {
  const schema = item.schema ?? {};
  return !!schema.properties || !!schema.additionalProperties || item.isObject;
}

function readInput(el) {
  if (el.type === "checkbox") return el.checked;
  if (el.type === "number") {
    if (el.value === "") return "";
    const number = Number(el.value);
    return Number.isNaN(number) ? el.value : number;
  }
  if (el.tagName === "SELECT") return el.options[el.selectedIndex].value;
  return el.value;
}

function debounce(fn, delay) {
  let timer = 0;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

class QgSettingsEditorViewElement extends HTMLElement {
  connectedCallback() {
    this.classList.add("qgSettingsEditor");
    ensureSettingsEditorCss();
  }
}

if (!customElements.get("qg-settings-editor")) {
  customElements.define("qg-settings-editor", QgSettingsEditorViewElement);
}

globalThis.qgSettingsEditor = function deprecatedSettingsEditorInit() {
  console.warn("[deprecated] qgSettingsEditor() is legacy. Use <settings-editor> instead.");
};

class SettingsEditorElement extends HTMLElement {
  #loadedSource = null;
  #source = null;
  #item = null;

  static get observedAttributes() {
    return ["source"];
  }

  connectedCallback() {
    this.addEventListener("change", (event) => this.#saveInput(event));
    this.addEventListener(
      "input",
      debounce((event) => this.#saveInput(event), 400),
    );
    this.addEventListener("click", (event) => this.#click(event));
    this.#load();
  }

  attributeChangedCallback(name, oldValue, newValue) {
    if (name === "source" && oldValue !== newValue && this.isConnected) {
      this.#load();
    }
  }

  async #load() {
    const raw = this.getAttribute("source") ?? "";
    if (!raw || raw === this.#loadedSource) return;
    try {
      this.#source = normalizeSource(JSON.parse(raw));
      this.#loadedSource = raw;
      this.innerHTML = "<em>Lade Einstellungen...</em>";
      const [data, schema] = await Promise.all([
        apiGet(this.#source, []),
        apiGet(this.#source, [], true),
      ]);
      this.#item = await settingsItem(data, schema);
      if (!this.#item) throw new Error("item.js unavailable");
      await this.#render();
    } catch (err) {
      console.error("settings-editor load failed", err);
      this.textContent = "Einstellungen konnten nicht geladen werden.";
    }
  }

  async #render() {
    ensureSettingsEditorCss();
    const html = await renderItems(this.#item);
    this.innerHTML = `<qg-settings-editor>${html || "<em>Keine Einstellungen vorhanden.</em>"}</qg-settings-editor>`;
  }

  async #saveInput(event) {
    const el = event.target;
    if (!this.#source || !el?.name || el.type === "hidden") return;
    let path;
    try {
      path = JSON.parse(el.name);
    } catch {
      return;
    }
    try {
      const value = readInput(el);
      await apiWrite("PUT", this.#source, path, value);
      this.#item.sub(path).set(value, { local: true });
    } catch (err) {
      console.error("settings-editor save failed", err);
    }
  }

  async #click(event) {
    const toggle = event.target.closest(".toggle");
    if (toggle) {
      const row = toggle.closest(".-row");
      const id = row?.dataset.path;
      if (!id) return;
      if (opened.has(id)) opened.delete(id);
      else opened.add(id);
      await this.#render();
      return;
    }

    const remove = event.target.closest(".-rem");
    if (!remove) return;
    if (!confirm("Möchten Sie die Einstellung wirklich löschen?")) return;
    const row = remove.closest(".-row");
    const id = row?.dataset.path;
    if (!id) return;
    const path = JSON.parse(id);
    try {
      await apiWrite("DELETE", this.#source, path);
      await this.#item.has(path)?.remove({ local: true });
      row.closest("li")?.remove();
    } catch (err) {
      console.error("settings-editor delete failed", err);
    }
  }
}

globalThis.QgSettingsEditorElement = SettingsEditorElement;

if (!customElements.get("settings-editor")) {
  customElements.define("settings-editor", SettingsEditorElement);
}

function ensureSettingsEditorCss() {
  if (document.getElementById("qgSettingsEditorCss")) return;
  const css = `
qg-settings-editor { display:block; }
.qgSettingsEditor {
  > ul {
    max-width:700px; background:#fff;
    &:not(.-hasSub) > li > .-row > .-toggle { display:none; }
  }
  ul { list-style:none; padding:0; margin:0; }
  ul ul { padding-left:20px; }
  .-row {
    border-bottom:1px solid #f4f4f4; display:flex; align-items:center;
    &:hover { background:#f4f4f4; }
    > * { padding:5px; }
    > .-name { flex:1 0 auto; }
    > .-inp { flex:0 1 320px; }
  }
  input:not([type=checkbox]), select, textarea { width:100%; box-sizing:border-box; }
  textarea { height:120px; }
  .-rem { text-align:center; color:transparent; }
  .-toggle > a, .-rem > a {
    display:block; color:transparent; width:1.8em; height:1.8em;
    background-repeat:no-repeat; background-position:50%;
  }
  .-rem > a { background-image:${svgUrl(remImgData)}; cursor:pointer; }
  .-toggle > .-minus { background-image:${svgUrl(closeImgData)}; cursor:pointer; background-size:95%; }
  .-toggle > .-plus { background-image:${svgUrl(openImgData)}; cursor:pointer; background-size:95%; }
}
`;
  document.head.append(c1.dom.fragment("<style id=qgSettingsEditorCss>" + css + "</style>"));
}

function svgUrl(svg) {
  return `url(data:image/svg+xml;utf8,${encodeURIComponent(svg)})`;
}

const remImgData =
  '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path d="M19,4H15.5L14.5,3H9.5L8.5,4H5V6H19M6,19A2,2 0 0,0 8,21H16A2,2 0 0,0 18,19V7H6V19Z" /></svg>';
const openImgData =
  '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" stroke="#000" stroke-width="4.6">' +
  '<line x1="8" y1="32" x2="56" y2="32"/>' +
  '<line x1="32" y1="8" x2="32" y2="56"/>' +
  "</svg>";
const closeImgData =
  '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" stroke="#000" stroke-width="4.6">' +
  '<line x1="8" y1="32" x2="56" y2="32"/>' +
  "</svg>";
