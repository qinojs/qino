import { t } from "@qino/pub/qino.js";
import { nodePanel } from "@qino/m/cms.backend/pub/js/node.mjs";
import { EmailClientSimulator, clients } from "./emailClientSimulator.js";

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

cms.initNode("backend.superuser.messaging.templates", (el) => {
  el.addEventListener("click", (event) => { // a placeholder is meant to be pasted into the template
    const code = event.target.closest("code[data-copy]");
    if (!code) return;
    navigator.clipboard.writeText(code.textContent).then(() => {
      code.dataset.copy = "done";
      setTimeout(() => code.dataset.copy = "", 1000);
    }, () => {});
  });

  const frame = el.querySelector(".-frame");
  if (!frame) return; // the overview has no preview
  const card = el.querySelector(".-markup");
  const { node } = nodePanel(el);
  const out = el.querySelector(".-text");
  const source = el.querySelector("[name=text]");
  const format = el.querySelector("[name=format]");
  const select = el.querySelector(".-client"); // mail only: there is no client to simulate elsewhere
  const notes = el.querySelector(".-notes");
  const findings = el.querySelector(".-report");
  const channel = new URLSearchParams(location.search).get("channel");
  const nothing = t`Renders unchanged.`;
  let markup = frame.getAttribute("srcdoc");

  if (select) {
    for (const [key, c] of Object.entries(clients)) select.append(new Option(c.label, key));
    select.value = clients[localStorage[store]] ? localStorage[store] : "outlookWord";
    select.addEventListener("change", () => { localStorage[store] = select.value; paint(); });
  }

  /** What the server rendered, as the chosen client would show it. */
  function paint() {
    card.hidden = !markup;
    if (!markup) return;
    if (!select) return void (frame.srcdoc = markup);
    const sim = new EmailClientSimulator(markup);
    const { client, html, report: changes } = sim.render(select.value);
    frame.srcdoc = html;
    frame.style.width = client.width + "px";
    notes.textContent = client.notes ?? "";
    if (!report(findings, [...sim.check(select.value), ...changes])) {
      nothing.then((text) => { if (!findings.childElementCount) findings.textContent = text; }, () => {});
    }
  }

  // the server renders what stands in the editor: markers and markdown have one truth, and it is not here
  const preview = async () => {
    const answer = await node.api.post({ preview: { text: source.value, format: format.value, channel } }).catch(() => null);
    if (!answer?.ok) return;
    markup = answer.html ?? "";
    out.textContent = answer.text;
    paint();
  };

  let timer;
  el.addEventListener("input", (event) => { // input from the editor's shadow textarea arrives retargeted
    if (!event.target.closest(".-editor")) return;
    clearTimeout(timer);
    timer = setTimeout(preview, 400);
  });
  format.addEventListener("change", preview);
  paint();
});
