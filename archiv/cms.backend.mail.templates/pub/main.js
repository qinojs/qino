import { t } from "@qino/pub/qino.js";
import { EmailClientSimulator, clients } from "@qino/m/cms.backend.mail/pub/emailClientSimulator.js";

const rank = { error: 0, warn: 1, info: 2 };
const store = "qino.mailClient";

/** One line per finding, identical findings collapsed to a count. */
function report(el, entries) {
  const seen = new Map();
  for (const e of entries) {
    const key = `${e.level}|${e.what}|${e.why}`;
    const hit = seen.get(key);
    if (hit) hit.count++;
    else seen.set(key, { ...e, count: 1 });
  }
  const ul = document.createElement("ul");
  for (const e of [...seen.values()].sort((a, b) => rank[a.level] - rank[b.level])) {
    const li = ul.appendChild(document.createElement("li"));
    li.className = "-" + e.level;
    li.append(e.why);
    if (e.what) li.append(" ", Object.assign(document.createElement("code"), { textContent: e.what }));
    const note = e.count > 1 ? `${e.count}x` : e.where;
    if (note) li.append(" ", Object.assign(document.createElement("small"), { textContent: note }));
  }
  el.replaceChildren(...(seen.size ? [ul] : []));
  return seen.size;
}

cms.initNode("backend.mail.templates", (el) => {
  const preview = el.querySelector(".-preview");
  if (!preview) return;
  const frame = preview.querySelector(".-preview-frame");
  const editor = el.querySelector(".-body-editor");
  const select = el.querySelector(".-client");
  const notes = el.querySelector(".-notes");
  const findings = el.querySelector(".-report");
  const main = preview.dataset.main ?? "";
  const nothing = t`Renders unchanged.`;

  // same markers as renderMarkers() on the server, with sample content for {{main}}
  const fill = (tpl) => tpl.trim()
    ? tpl.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_, key) => key.trim() === "main" ? main : "")
    : main;

  for (const [key, c] of Object.entries(clients)) select.append(new Option(c.label, key));
  select.value = clients[localStorage[store]] ? localStorage[store] : "outlookWord";

  const show = () => {
    const sim = new EmailClientSimulator(editor ? fill(editor.value) : frame.getAttribute("srcdoc"));
    const { client, html, report: changes } = sim.render(select.value);
    frame.srcdoc = html;
    frame.style.width = client.width + "px";
    notes.textContent = client.notes ?? "";
    if (!report(findings, [...sim.check(select.value), ...changes])) {
      nothing.then(text => { if (!findings.childElementCount) findings.textContent = text; }, () => {});
    }
  };

  let timer;
  editor?.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(show, 400); });
  select.addEventListener("change", () => { localStorage[store] = select.value; show(); });
  show();
});
