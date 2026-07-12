import { apt } from "./qino.js";

const opened = new Set();
export const itemJs = import("@qino/item/item.js");
const itemJsHtmlRenderer = import("@qino/item/tools/schema/render/html.js").then((mod) => mod.toInput);

const escapes = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };
const escapeHtml = (v) => String(v ?? "").replace(/[&<>"]/g, (c) => escapes[c]);

const aptPath = (endpoint) => {
  const [ns, name, ...path] = endpoint.replace(/^\/api\//, "").split("/").filter(Boolean);
  return path.length ? apt[ns][name](path) : apt[ns][name];
};
function apiWrite(method, base, path, value) {
  const api = path.reduce((a, k) => a[k], base);
  const del = method === "DELETE";
  return api[del ? "delete" : method.toLowerCase()](del ? {} : { value });
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
    const eid = escapeHtml(id);
    const key = escapeHtml(child.key);
    const isOpen = opened.has(id);
    const title = typeof cs.description === "string" && cs.description ? ` title="${escapeHtml(cs.description)}"` : "";
    const toggle = objectNode
      ? `<a class="toggle -${isOpen ? "minus" : "plus"}"></a>`
      : "<a class=toggle></a>";
    const input = objectNode
      ? `<input type="hidden" name="${eid}">`
      : (await itemJsHtmlRenderer)(cs, { value: child.get({ silent: true }), name: id });
    const sub = objectNode && isOpen ? await renderItems(child) : "";
    html += `<li><span class=-row data-path="${eid}">` +
      `<span class=-toggle>${toggle}</span><span class=-name${title}>${key}</span>` +
      `<span class=-inp>${input}</span><span class=-rem><a>x</a></span></span>${sub}</li>`;
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
  if (el.type === "number") { const n = el.valueAsNumber; return isNaN(n) ? el.value : n; }
  return el.value;
}

function debounce(fn, delay) {
  let timer = 0;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

class SettingsEditorElement extends HTMLElement {
  #loadedSource = null;
  #source = null;
  #item = null;

  static observedAttributes = ["source"];

  constructor() {
    super();
    this.addEventListener("change", (event) => this.#saveInput(event));
    this.addEventListener("input", debounce((event) => this.#saveInput(event), 400));
    this.addEventListener("click", (event) => this.#click(event));
  }

  connectedCallback() {
    this.#load();
  }

  attributeChangedCallback(_name, oldValue, newValue) {
    if (oldValue !== newValue && this.isConnected) this.#load();
  }

  async #load() {
    const raw = this.getAttribute("source") ?? "";
    if (!raw || raw === this.#loadedSource) return;
    try {
      this.#source = aptPath(raw);
      this.#loadedSource = raw;
      this.innerHTML = "<em>Lade Einstellungen...</em>";
      const [data, schema] = await Promise.all([this.#source.get(), this.#source.get({ schema: true })]);
      this.#item = (await itemJs).item(data ?? {});
      this.#item.setSchema(schema ?? {});
      await this.#render();
    } catch (err) {
      console.error("settings-editor load failed", err);
      this.textContent = "Einstellungen konnten nicht geladen werden.";
    }
  }

  async #render() {
    ensureSettingsEditorCss(this.getRootNode());
    const html = await renderItems(this.#item);
    this.innerHTML = `<div class=qgSettingsEditor>${html || "<em>Keine Einstellungen vorhanden.</em>"}</div>`;
  }

  async #saveInput(event) {
    const el = event.target;
    if (!this.#source || !el?.name || el.type === "hidden") return;
    let path;
    try { path = JSON.parse(el.name); }
    catch { return; }
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
    const remove = toggle ? null : event.target.closest(".-rem");
    if (!toggle && !remove) return;
    const row = (toggle ?? remove).closest(".-row");
    const id = row?.dataset.path;
    if (!id) return;
    if (toggle) {
      if (opened.has(id)) opened.delete(id); else opened.add(id);
      await this.#render();
      return;
    }
    if (!confirm("Really delete this setting?")) return;
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

customElements.define("settings-editor", SettingsEditorElement);

function ensureSettingsEditorCss(root = document) {
  root = root.getElementById ? root : document;
  if (root.getElementById("qgSettingsEditorCss")) return;
  const css = `
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
  const style = (root.ownerDocument || root).createElement("style");
  style.id = "qgSettingsEditorCss";
  style.textContent = css;
  (root.head || root).append(style);
}

function svgUrl(svg) { return `url(data:image/svg+xml;utf8,${encodeURIComponent(svg)})`; }

const remImgData =
  '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path d="M19,4H15.5L14.5,3H9.5L8.5,4H5V6H19M6,19A2,2 0 0,0 8,21H16A2,2 0 0,0 18,19V7H6V19Z" /></svg>';
const openImgData =
  '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" stroke="#000" stroke-width="4.6">' +
  '<line x1="8" y1="32" x2="56" y2="32"/>' +
  '<line x1="32" y1="8" x2="32" y2="56"/>' +
  "</svg>";
const closeImgData =
  '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" stroke="#000" stroke-width="4.6"><line x1="8" y1="32" x2="56" y2="32"/></svg>';
