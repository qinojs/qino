import { api } from "@qino/pub/api.js";
import { t } from "@qino/pub/t.js";
import { markdown } from "@qino/m/cms.backend.ai1/pub/markdown.js";

/** The answers in `box` as markdown. */
const render = async (box) => {
  for (const div of box.querySelectorAll("[data-md]")) div.innerHTML = await markdown(div.textContent);
};

// The tables follow what is going on, every few seconds while the page is open: the list of agents and
// all sessions, or an agent's page (`?agent=`). On a session's page (`?session=`) only its conversation
// follows along.
cms.initNode("backend.ai1.agents", (el) => {
  const nid = Number(cms.el.nid(el));
  const agents = api["ai1.agent"], node = api.cms.node(nid);
  const alert = async (message) => (await import("@qino/u2/js/dialog/dialog.js")).alert(message);
  let waiting;
  const weights = (form) => Object.fromEntries([...form.querySelectorAll("[data-prefer]")].filter((s) => +s.value).map((s) => [s.dataset.key, +s.value]));
  const preview = (form) => {
    clearTimeout(waiting);
    waiting = setTimeout(async () => {
      const { list = [] } = await node.api.post({ preview: weights(form) }).catch(() => ({}));
      form.querySelector("[data-preview]").replaceChildren(...list.map((c) => Object.assign(document.createElement("li"), { textContent: `${c.model} @ ${c.provider} (${c.rank})` })));
    }, 150);
  };
  el.addEventListener("input", (e) => {
    if (!("prefer" in e.target.dataset)) return;
    e.target.nextElementSibling.value = e.target.value;
    preview(e.target.form);
  });
  const chosen = (form) => [...form.querySelectorAll("[name=tools]:checked")].map((box) => box.closest("u2-tree"))
    .filter((item) => !item.parentElement.closest("u2-tree")?.querySelector(":scope > [name=tools]").checked)
    .map((item) => item.querySelector(":scope > [name=tools]").value);
  for (const form of el.querySelectorAll("[data-agent]")) {
    preview(form);
    if (!form.dataset.agent) continue;
    const current = { system: () => form.elements.system.value, tools: () => chosen(form), prefer: () => weights(form) };
    const timers = new Map();
    let saving = Promise.resolve();
    const fieldOf = (target) => target.name === "system" || target.name === "tools" ? target.name : "prefer" in target.dataset ? "prefer" : null;
    const save = (field) => {
      clearTimeout(timers.get(field));
      saving = saving.catch(() => {}).then(() => agents.agent(Number(form.dataset.agent)).patch({ [field]: current[field]() }))
        .catch((err) => alert(err.message));
    };
    form.addEventListener("input", (e) => {
      const field = fieldOf(e.target);
      if (!field) return;
      clearTimeout(timers.get(field));
      timers.set(field, setTimeout(() => save(field), 400));
    });
    form.addEventListener("change", (e) => {
      const field = fieldOf(e.target);
      if (field) save(field);
    });
  }
  el.addEventListener("submit", async (e) => {
    const form = e.target;
    if (!("agent" in form.dataset)) return;
    e.preventDefault();
    if (form.dataset.agent) return;
    const values = { system: form.elements.system.value, tools: chosen(form), prefer: weights(form) };
    try {
      await agents.agents.post(values);
      location.reload();
    } catch (err) { await alert(err.message); }
  });
  const query = new URL(location.href).searchParams, agent = query.get("agent"), session = query.get("session");
  const parts = session ? [] : agent ? ["agent", "sessions", "memories", "tools"] : ["agents", "sessions"];
  const vars = agent ? { agent } : {};
  el.addEventListener("click", async (e) => {
    const button = e.target.closest("button[data-memory]");
    if (!button) return;
    const { form } = await import("@qino/u2/js/dialog/dialog.js");
    const title = await t`Edit memory`;
    const { content } = await form({
      body: '<label><textarea name=content rows=10 style="display:block;width:min(40rem,80vw)"></textarea></label>',
      init(dialog) {
        dialog.querySelector("label").prepend(title);
        dialog.querySelector("textarea").value = button.dataset.content;
      },
    }) ?? {};
    if (!content?.trim() || content === button.dataset.content) return;
    button.disabled = true;
    try {
      await agents.agent(Number(agent)).memories.post({ content, replaces: Number(button.dataset.memory) });
      await cms.reloadPart(nid, "memories", vars);
    } catch (err) { await alert(err.message); }
    finally { button.disabled = false; }
  });
  // the tool calls of the session with their results: the list left, the chosen one right
  const showCalls = async (select) => {
    const [{ calls }, { modal }, ...label] = await Promise.all([
      node.api.post({ calls: Number(session), call: select }), import("@qino/u2/js/dialog/dialog.js"), t`Arguments`, t`Result`, t`Close`, t`Run`,
    ]);
    const dom = (tag, props, ...kids) => {
      const el = Object.assign(document.createElement(tag), props);
      el.append(...kids);
      return el;
    };
    const pretty = (v, indent = 2) => typeof v === "string" ? v : JSON.stringify(v, null, indent);
    const code = (value, readonly) => {
      const text = dom("textarea", { value: pretty(value), readOnly: !!readonly, rows: 8 });
      const el = dom("u2-code", { style: "font-size:.8rem;overflow:auto;max-height:45vh" }, text);
      el.setAttribute("language", "json");
      return el;
    };
    const part = (title, el, ...more) => dom("div", { style: "flex:1 1 30rem;min-width:0" }, dom("small", { textContent: title }), el, ...more);
    const items = new Map(), list = dom("div", { style: "flex:0 1 14rem;overflow:auto;max-height:55vh" }), detail = dom("div", { className: "u2-flex", style: "flex:1 1 30rem;min-width:0;align-content:start" });
    let step, row; // the calls of one step stand together in a row: the model asked for them at once
    calls.forEach((call) => {
      if (call.step !== step) {
        step = call.step;
        row = dom("div", { className: "u2-flex", style: "--u2-Gap:.3rem" });
        list.append(dom("small", { textContent: new Date(call.time * 1000).toLocaleTimeString(), style: "display:block;margin-top:1rem" }), row);
      }
      const button = dom("button", { type: "button", className: "u2-unstyle", title: pretty(Object.values(call.args ?? {})[0] ?? "", 0).slice(0, 80) },
        dom("div", { className: "u2-badge", style: `background-color:${call.color};color:white` },
          dom("span", { textContent: "▶", style: "display:none;font-size:.7em;margin-inline-end:.5rem" }), `${call.name}${call.failed ? " !" : ""}`));
      button.onclick = () => {
        for (const other of items.values()) other.removeAttribute("aria-current"), other.firstChild.firstChild.style.display = "none";
        button.setAttribute("aria-current", "true");
        button.firstChild.firstChild.style.display = "";
        button.scrollIntoView({ block: "nearest" });
        const input = code(call.args), output = code(call.result ?? "", true);
        const run = dom("button", { type: "button", textContent: label[3] });
        run.onclick = async () => {
          run.disabled = true;
          try { output.value = pretty((await api.core["tool-calls"].post({ calls: [{ name: call.name, arguments: JSON.parse(input.value) }] })).results[0] ?? null); }
          catch (err) { output.value = pretty({ error: err.message, ...err.data !== undefined && { data: err.data } }); }
          finally { run.disabled = false; }
        };
        detail.replaceChildren(part(label[0], input, run), part(label[1], output));
      };
      items.set(call.id, button);
      row.append(button);
    });
    const body = dom("div", { className: "u2-flex", style: "width:min(90vw,80rem)" }, list, detail);
    await modal({
      body: "<div data-calls></div>",
      buttons: [{ title: label[2] }],
      init(dialog) {
        dialog.classList.add("backdropClose");
        dialog.style.cssText = "top:3rem;bottom:auto";
        dialog.querySelector("[data-calls]").replaceWith(body);
        (items.get(select) ?? items.values().next().value)?.click();
        dialog.addEventListener("keydown", (e) => {
          const all = [...items.values()], now = all.findIndex((b) => b.getAttribute("aria-current")), to = { ArrowUp: -1, ArrowDown: 1 }[e.key];
          if (to && all[now + to]) e.preventDefault(), all[now + to].click();
        });
      },
    });
  };
  el.addEventListener("click", (e) => {
    const button = e.target.closest("button[data-call]");
    if (button) showCalls(button.dataset.call).catch((err) => alert(err.message));
  });
  const refresh = () => Promise.all(parts.map((part) => cms.reloadPart(nid, part, vars)));
  const timer = setInterval(() => el.isConnected ? refresh() : clearInterval(timer), 10000);
  const box = el.querySelector("[cms-part=conversation]");
  if (!box) return;
  const end = () => box.scrollTop = box.scrollHeight;
  render(box).then(end); // starts at the latest message
  // only the messages since the last one are added, so what is opened or selected stays as it is; who
  // is at the end stays there
  const poll = setInterval(async () => {
    if (!el.isConnected) return clearInterval(poll);
    const list = box.firstElementChild;
    const after = Number(list?.querySelector(":scope > [data-message]:last-child")?.dataset.message ?? 0);
    const more = document.createElement("template");
    more.innerHTML = await api.cms.node(nid).html.part("conversation").post({ vars: { session, after } }).catch(() => "");
    const added = more.content.firstElementChild?.children;
    if (!list || !added?.length) return;
    const news = [...added], atEnd = box.scrollHeight - box.scrollTop - box.clientHeight < 10;
    list.append(...news);
    await Promise.all(news.map(render));
    if (atEnd) end();
  }, 3000);
});
