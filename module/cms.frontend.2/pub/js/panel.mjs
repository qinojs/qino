import { itemJs } from "@qino/pub/SettingsEditor.mjs";
import { api, t, ctx } from "@qino/pub/qino.js";

import "./frontend.mjs";

const nodeId = globalThis.qino?.cms?.nodeId;

const PANEL_STYLES = [
  import.meta.resolve("@qino/u2/css/norm/norm.css"),
  import.meta.resolve("@qino/u2/css/base/base.css"),
  "cms/pub/css/ui.css",
  "cms.frontend.2/pub/css/off.css",
  "cms.frontend.2/pub/css/panel.css",
  "cms.frontend.2/pub/css/tree.css",
];

customElements.define("qino-cms", class extends HTMLElement {
  connectedCallback() {
    if (this.shadowRoot) return;
    const root = this.attachShadow({ mode: "open" });
    for (const href of PANEL_STYLES) root.append(Object.assign(document.createElement("link"), { rel: "stylesheet", href: /^https?:/.test(href) ? href : ctx.moduleUrl + href }));
    while (this.firstChild) root.append(this.firstChild);
    requestAnimationFrame(() => this.hidden = false);
  }
});

const on = (el, events, fn) => events.split(" ").forEach(e => el.addEventListener(e, fn));
const sel = s => s[0] === ">" ? ":scope " + s : s;
const findEl = (el, s) => el.querySelector(sel(s));
const findAll = (el, s) => el.querySelectorAll(sel(s));
function setHtml(el, html) {
  el.innerHTML = html;
  for (const s of el.querySelectorAll("script")) console.warn("Script tag in CMS widget HTML", s);
}
function setSetting(value, path) {
  const p = Array.isArray(path) ? path : String(path || "").split("/").filter(Boolean);
  return api.core["ctx-settings"](p).put({ value });
}

const { item } = await itemJs;
const uiState = item(cmsFrontend2Data ?? {});
const sidebar = uiState.item("sidebar");
const widgets = uiState.item("widget");
if (!widgets.filled) widgets.set({});

cms.panel = { state: uiState, sidebar, widgets };
const el = document.querySelector("qino-cms").shadowRoot.getElementById("panel");
el.showPopover();
const root = cms.panelRoot = el.getRootNode();
const [
  { SelectorObserver },
  { scope: dialogScope },
] = await Promise.all([
  import("@qino/u2/js/SelectorObserver/SelectorObserver.js"),
  import("@qino/u2/js/dialog/dialog.js"),
]);
// isolate dialog interactions (incl. backdrop) from page-level handlers: content marking, context menu, …
const isolate = el => ['click','mousedown','touchstart'].forEach(type =>
  el.addEventListener(type, e => e.stopPropagation()));
const scoped = dialogScope({ root, init: isolate }); // central scoped dialogs (panel shadow root)
// t`` returns a thenable -> await text, else u2 treats the promise as the options object (body becomes "undefined")
cms.dialogs = {
  ...scoped,
  alert:   async (text)          => scoped.alert(await text),
  confirm: async (text)          => scoped.confirm(await text),
  prompt:  async (text, initial) => scoped.prompt(await text, initial),
};
const { alert, confirm } = cms.dialogs;
function onEl(selector, fn) {
  new SelectorObserver({ on: el => requestAnimationFrame(() => fn(el)) }).observe(selector, { root });
}

/* sidebar */
const loadWidget = (widget, params, cb) => {
  const widgetEl = findEl(el, '[widget="' + widget + '"]');
  if (!widgetEl) return;
  import("@qino/pub/c1/loading.mjs").then(({ default: loading }) => {
    loading.mark(widgetEl);
    params ||= {};
    params.pid ||= cms.cont.active || nodeId;
    api['cms.frontend.2'].widget(widget).post({ params }).then((res) => {
      loading.done(widgetEl);
      setHtml(widgetEl, res);
      cb?.({ target: widgetEl });
    });
  });
};


uiState.addEventListener("changeIn", () => {
  setSetting(uiState.get({ silent: true }), ["cms.frontend.2", "ui"]); // why silent? should we debounce?
});

function syncSidebar(value = sidebar.value) {
  findAll(el, "> .-sidebar > .-item").forEach((el) => el.classList.remove("-open"));

  if (value) {
    const item = findEl(el, '> .-sidebar > .-item[itemid="' + value + '"]');
    if (!item) return;
    item.classList.add("-open");
    item.focus();

    el.classList.add("-open");
    const content = findEl(el, '> .-sidebar > [itemid="' + value + '"] > .-content');
    if (!content) return;
    loadWidget(value, { pid: cms.cont.active || nodeId });
  } else {
    el.classList.remove("-open");
  }
}
sidebar.addEventListener("set", e => syncSidebar(e.value)); // load only on change; initial state comes from SSR

el.addEventListener("click", (e) => {
  const titelEl = e.target.closest(".-sidebar > .-item > .-title");
  if (!titelEl) return;
  cms.cont.active = nodeId;
  sidebar.set(titelEl.closest("[itemid]").getAttribute("itemid"));
});

/* widgets */
widgets.addEventListener("setIn", e => {
  if (e.target.parent !== widgets) return;
  if (e.value) loadWidget(e.target.key, { pid: cms.cont.active || nodeId });
});
el.addEventListener("click", (e) => {
  if (e.button !== 0) return;
  const wHead = e.target.closest(".-widgetHead");
  if (!wHead) return;
  e.preventDefault();
  const value = wHead.classList.toggle("-open");
  const name = wHead.nextElementSibling.getAttribute("widget");
  if (!name) return;
  widgets.item(name).set(value);
});

on(findEl(el, "> .-sidebar > .-sensor"), "mouseenter touchstart", () => el.classList.add("-sidebar-open"));

on(document, "mousedown touchstart", e => {
  if (e.type === "mousedown" && e.button !== 0) return;
  if (e.composedPath().includes(el)) return;
  el.classList.remove("-sidebar-open");
  sidebar.set("");
});

// shortcuts
document.addEventListener("keydown", (e) => {
  const target = e.composedPath()[0]; // real element even inside shadow DOM (e.target would be the host)
  if (target.getRootNode() !== document) return; // from shadow DOM = a component (tree/panel/…) owns the key
  if (target.isContentEditable || target.form !== undefined) return; // inputs/contenteditable in the light DOM (page content)
  if (e.shiftKey || e.metaKey || e.altKey || e.ctrlKey) return;

  if (e.key == "t") {
    cms.cont.active = cms.contPos.active?.pid;
    sidebar.set("tree");
    e.preventDefault();
  }
  if (e.key == " ") {
    cms.cont.active = cms.contPos.active?.pid;
    sidebar.set("settings");
    e.preventDefault();
  }
  if (e.key == "v") sidebar.set(sidebar.value === "add" ? "" : "add");
  if (e.key == "Escape") sidebar.set("");
  if (e.key == "n") { // n
    sidebar.set("tree");
    setTimeout(() => {
      const inp = findEl(el, "#page-add");
      inp?.focus();
    }, 700);
  }
});

api.on("POST cms/node/:id/contents", () => sidebar.set(""));

cms.cont.on("upload", (ev) => {
  cms.cont(ev.pid).showWidget("media");
  ev.on("progress", (e) => {
    const percent = Math.round(e.loaded * 100 / e.total);
    const button = findEl(el, '[cmsconf="contMedia_overview"] button');
    if (button) {
      button.innerHTML = percent + "%";
      button.style.minWidth = "150px";
      button.style.backgroundImage =
        "linear-gradient(to right, var(--cms-color); 0%, var(--cms-color); " +
        percent + "%, transparent " + percent + "%, transparent)";
    }
  });
  ev.on("complete", () => {
    cms.console.show(t`File uploaded`);
    cms.cont(ev.pid).showWidget("media", true);
  });
});

api.on("POST cms/node/:id/files", ({ params: { id } }) => {
  cms.cont(id).showWidget("media", true);
});
cms.cont.prototype.showWidget = function (what, reload) {
  if (!reload) {
    if (
      cms.cont.active == this.id && what === widgets.has(what)?.get({ silent: true })
    ) return;
  }
  cms.cont.active = this.id;
  widgets.item(what).set(1);
  sidebar.set("settings");
  cms.Tree?.goTo(this.id);
};

!document.querySelector("[qcms-edit][qcms-drop]") &&
  findEl(el, "> .-sidebar > [itemid=add]").setAttribute("hidden", "hidden");

const switches = [
  ...document.querySelectorAll(".qgCMS_editmode_switch"),
  ...root.querySelectorAll(".qgCMS_editmode_switch"),
];
function enter() {
  el.classList.add("-open", "-sidebar-open");
}
for (const switc of switches) {
  on(switc, "mouseenter touchstart", enter);
}

/* update accordion-heads */
api.on("PATCH cms/node/:id", ({ input }) => { ("onlineStart" in input || "onlineEnd" in input) && loadWidget("access.time.head"); });
api.on("PUT cms/node/:id/access",       () => loadWidget("access.grp.head"));
api.on("PUT cms/node/:id/access/groups/*", () => loadWidget("access.grp.head"));
api.on("PUT cms/node/:id/access/users/*",  () => loadWidget("access.usr.head"));
api.on("DELETE cms/node/:id/files/*",   () => loadWidget("media.head"));
api.on("DELETE cms/node/:id/files/doubles", () => loadWidget("media.head"));
api.on("DELETE cms/node/:id/files/all", () => loadWidget("media.head"));
api.on("POST cms/node/:id/redirects",   () => loadWidget("urls.head"));
api.on("DELETE cms/node/:id/redirects", () => loadWidget("urls.head"));

onEl(".tree-manager", async (el) => {
  await import("./tree.mjs");
  // add Page
  const inp = root.getElementById("page-add");
  function add() {
    const v = inp.value.trim();
    v && cms.Tree.addPage(v);
    inp.value = "";
  }
  inp.addEventListener("blur", async (e) => {
    if (e.currentTarget.value && await confirm(t`Create page "${e.currentTarget.value}"?`)) add();
  });
  inp.addEventListener("keydown", (e) => {
    e.key === "Enter" && add();
    if (e.key === "Escape") {
      e.currentTarget.value = "";
      e.currentTarget.blur();
    }
  });
  const tree = JSON.parse(el.getAttribute("data"));
  await cmsTreeInit(tree);
  // change placeholder
  cms.Tree.onActivate = (node) => {
    inp.placeholder = inp.placeholder.replace(/"([^"]*)"/, `"${node.data.title}"`);
  };
});

onEl(".file-manager", (el) => {
  const pid = el.getAttribute("pid");
  const node = api.cms.node(pid);
  import("@qino/pub/c1/form.mjs").then(() => {
    findEl(el, ".-uploadBtn").addEventListener("click", async () => {
      const files = await c1.form.fileDialog();
      upload(files);
    });
  });
  const tbody = findEl(el, "tbody");
  if (tbody) {
    for (const tr of tbody.children) {
      const img = tr.querySelector(".-preview > img");
      let f = 1, oW, oH;
      if (!img) continue;
      img.parentNode.addEventListener("wheel", (e) => {
        if (f === 1) {
          oW = img.offsetWidth;
          oH = img.offsetHeight;
        }
        e.preventDefault();
        const newf = e.wheelDelta < 0 ? f / 0.6666 : f * 0.6666;
        if (newf >= 1 && newf <= 15) {
          f = newf;
          const w = parseInt(f * oW);
          const h = parseInt(f * oH);
          new dbFile(img).set("h", h).set("w", w).write();
          img.height = h;
          img.width = w;
        }
      });
    }

    // DnD sorting via u2-dropzone: tbody[u2-dropzone] + tr[draggable] (template).
    // u2-draghandle (on td.-handle) makes only the handle draggable. After the drop
    // the DOM order is the new sort order -> send to server.
    import("@qino/u2/attr/dropzone/dropzone.js");
    import("@qino/u2/attr/draghandle/draghandle.js");
    tbody.addEventListener("u2-dropzone-drop", (e) => {
      if (!e.detail?.add) return; // the same zone fires remove+add -> react only once
      requestAnimationFrame(() => {
        const sort = [...tbody.children].map((el) => el.getAttribute("itemid"));
        node.files.put({ sort });
      });
    });
    tbody.addEventListener("click", async (e) => {
      const del = e.target.closest(".-delete");
      if (del) {
        const tr = del.closest("tr");
        if (await confirm(t`Really delete this file?`)) node.files(tr.getAttribute("itemid")).delete().then(() => tr.remove());
        return;
      }
      const preview = e.target.closest(".-preview");
      if (preview) {
        const replaces = preview.closest("tr").getAttribute("itemid");
        c1.form.fileDialog({ multiple: false }).then((files) => upload(files, replaces));
      }
    });
    tbody.addEventListener("dragstart", (e) => {
      const link = e.target.closest(".-preview > [draggable], .-link > a");
      if (link) sidebar.set("");
      if (e.target.matches("audio")) {
        e.dataTransfer.effectAllowed = "copy";
        e.dataTransfer.setData("text/html", e.target.outerHTML);
      }
    });
  }

  const upload = (files, replaces) => {
    for (const file of files) cms.cont(pid).upload(file, reload, replaces);
  };
  const reload = () => {
    cms.reloadNode(pid);
    widgets.item("media").set(1);
  };
  findEl(el, ".-addExistingFile").addEventListener(
    "select_by_pointer",
    (e) => e.currentTarget.value && node.files.post({ file: e.currentTarget.value }),
  );
  if (findEl(el, ".-sortFilesSelect")) {
    findEl(el, ".-sortFilesSelect").addEventListener("change", (e) => {
      e.currentTarget.value && node.files.order.post({ by: e.currentTarget.value }).then(reload);
    });
    findEl(el, ".-deleteFilesSelect").addEventListener("change", async (e) => {
      const val = e.currentTarget.options[e.currentTarget.selectedIndex].value;
      if (val === "double") node.files.doubles.delete().then(reload);
      if (val === "all" && await confirm(t`Really delete all files?`)) node.files.all.delete().then(reload);
    });
  }
});
onEl(".module-manager", (el) => {
  import("@qino/pub/c1/loading.mjs"); // preload

  const searchInp = findEl(el, "input");
  searchInp.focus();
  searchInp.addEventListener("input", (e) => {
    for (const box of findAll(el, ".-module-boxes > *")) {
      box.style.display =
        box.textContent.toLowerCase().match(e.currentTarget.value.toLowerCase())
          ? "flex"
          : "none";
    }
  });

  /* add module */
  el.addEventListener("mousedown", (e) => {
    if (e.button !== 0) return;
    const box = e.target.closest(".-module-boxes > [itemid]");
    if (!box) return;
    const itemid = box.getAttribute("itemid");
    import("@qino/pub/c1/loading.mjs").then(({ default: loading }) => {
      loading.mark(box);
      if (box.closest(".add-models")) {
        api.cms.node(itemid).copy.post().then(({ id }) => {
          sidebar.set("");
          cms.cont(id).addPosition();
        });
      } else {
        cms.cont.add(itemid);
      }
    });
    e.preventDefault();
  });
});
onEl(".access-groups-manager", (el) => {
  const pid = el.getAttribute("pid");
  const node = api.cms.node(pid);
  findEl(el, ".-inherit").addEventListener("change", (e) => {
    const value = e.currentTarget.checked ? null : parseInt(e.currentTarget.value); // not inherit ? set it to what it was inherited
    node.access.put({ value });
    widgets.item("access.grp").set(1);
  });
  const searchInp = findEl(el, ".-search");
  searchInp?.addEventListener(
    "keyup",
    c1.debounce((e) => {
      loadWidget("access.grp.list", { pid, search: e.target.value });
    }, 150),
  );
  // change grp access
  el.addEventListener("change", (e) => {
    const inp = e.target;
    if (!inp.closest('[widget="access.grp.list"]')) return;
    inp.name === "public"
      ? node.access.put({ value: parseInt(inp.value) })
      : node.access.groups(inp.name.replace("g_", "")).put({ access: parseInt(inp.value) });
  });
});
onEl(".access-users-manager", (el) => {
  const pid = el.getAttribute("pid");
  const node = api.cms.node(pid);
  const searchInp = findEl(el, ".-search");
  searchInp?.addEventListener(
    "keyup",
    c1.debounce((e) => {
      loadWidget("access.usr.list", { pid, search: e.target.value });
    }, 150),
  );
  // change usr access
  el.addEventListener("change", (e) => {
    const inp = e.target;
    if (!inp.closest('[widget="access.usr.list"]')) return;
    node.access.users(inp.name.replace("u_", "")).put({ access: parseInt(inp.value) });
  });
});
onEl(".access-time-manager", (el) => {
  const node = api.cms.node(el.getAttribute("pid"));
  const reload = () => widgets.item("access.time").set(1);

  for (const [edge, field] of [["start", "onlineStart"], ["end", "onlineEnd"]]) {
    const set = (value) => { node.patch({ [field]: value }); reload(); };
    const inp = findEl(el, `.-${edge}`);
    const now = findEl(el, `.-${edge}_now`);
    inp.addEventListener("blur", () => set(inp.value));
    findEl(el, `.-${edge}_always`).addEventListener("click", () => set("0"));
    now.addEventListener("click", () => set(String(Math.ceil(Date.now() / 1000))));
    findEl(el, `.-${edge}_inherit`).addEventListener("click", () => set(""));
    inp.style.display = inp.value ? "block" : "none";
    now.style.display = inp.value ? "none" : "block";
  }
});
onEl(".url-manager", (el) => {
  const pid = el.getAttribute("pid");
  const node = api.cms.node(pid);
  findEl(el, "> .-urls").addEventListener("change", (e) => {
    const tr = e.target.closest("[data-lang]");
    const lang = tr.getAttribute("data-lang");

    let inp = e.target.closest(".-target");
    if (inp) {
      node.urls(lang).target.put({ value: inp.checked ? "_blank" : "" });
    }
    inp = e.target.closest(".-url");
    if (inp) {
      node.urls(lang).put({ url: inp.value });
      findEl(tr, ".-custom").checked = true;
    }
    inp = e.target.closest(".-custom");
    if (inp) {
      node.urls(lang).custom.delete().then(url => {
        findEl(tr, ".-url").value = url;
      });
    }
  });
  findEl(el, "> .-directlinks").addEventListener("click", (e) => {
    const del = e.target.closest(".-delete");
    if (!del) return;
    const tr = del.closest("[itemid]");
    const v = tr.getAttribute("itemid");
    tr.remove();
    node.redirects.delete({ url: v });
  });

  const addInp = findEl(el, ".-add_inp");
  addInp.addEventListener("keyup", c1.debounce((e) => {
    api.cms["request-used"].get({ url: e.target.value }).then(({ used }) => {
      e.target.style.border = used ? "1px solid red" : "1px solid green";
    });
  }, 200),
  );
  addInp.addEventListener("keydown", (e) => e.key === "Enter" && cmsRequestSet() );
  findEl(el, ".-add").addEventListener("click", cmsRequestSet);

  function cmsRequestSet() {
    const v = addInp.value;
    node.redirects.post({ url: v });
    widgets.item("urls").set(1);
  }
});
onEl(".advanced-manager", (el) => {
  const pid = el.getAttribute("pid");
  const node = api.cms.node(pid);
  findEl(el, ".-visible").addEventListener("change", (e) => {
    node.patch({ visible: e.currentTarget.checked });
  });
  findEl(el, ".-searchable").addEventListener("change", (e) => {
    node.patch({ searchable: e.currentTarget.checked });
  });
  findEl(el, ".-name").addEventListener(
    "input",
    c1.debounce((e) => {
      node.patch({ name: e.target.value });
    }, 400),
  );
  findEl(el, ".-name").addEventListener("change", (e) => {
    node.patch({ name: e.currentTarget.value });
  });
  findEl(el, ".-model").addEventListener("change", (e) => {
    setSetting(e.currentTarget.value, e.currentTarget.name);
    loadWidget("divers", { pid });
  });
  findEl(el, ".-basis").addEventListener("blur", (e) => {
    e.currentTarget.value && api.cms.node(String(e.currentTarget.value))["insert-before"].put({ id: String(pid) });
  });
  findEl(el, ".-childXML").addEventListener("change", (e) => {
    node.settings.childXML.put({ value: e.currentTarget.value });
  });
});
onEl(".seo-manager", (el) => {
  const desc = findEl(el, ".-desc");
  function checkTextarea(el) {
    el.classList.toggle("-invalid", !/^.{60,156}$/.test(el.value));
  }
  desc.addEventListener("input", (e) => checkTextarea(e.target));
  checkTextarea(desc);
  findEl(el, ".-seo-prio").addEventListener("change", (e) => {
    api.cms.node(e.currentTarget.dataset.pid).settings._seo_priority.put({ value: e.currentTarget.value });
  });
});
onEl(".more-manager", (el) => {
  findEl(el, ".-tour").onclick = () => import("./intro.mjs").then(({ start }) => start());
  // feedback-formular
  findEl(el, ".-feedbackform").addEventListener("submit", (e) => {
    e.preventDefault();
    loadWidget("more", {
      pid: nodeId,
      msg: findEl(e.currentTarget, "[name=msg]").value,
      link: location.href,
    });
  });
  findEl(el, ".-feedbackform [name=msg]").addEventListener(
    "input",
    c1.debounce((e) => {
      setSetting(e.target.value, ["cms", "feedback", "text"]);
    }, 200),
  );
  // change password
  findEl(el, ".-pwchange").addEventListener("submit", async (e) => {
    e.preventDefault();
    const oldpw = findEl(e.currentTarget, "[name=old]").value;
    const pw = findEl(e.currentTarget, "[name=new]").value;
    const pw2 = findEl(e.currentTarget, "[name=new2]").value;
    if (pw2 !== pw) await alert(t`Passwords do not match`);
    else {
      const res = await api.core.password.put({ oldpw, pw });
      if (res === 1) await alert(t`Password changed successfully.`);
      if (res === -1) await alert(t`The old password is incorrect.`);
      if (res === -2) await alert(t`The password is too short.`);
    }
  });
  findEl(el, ".-changelang").addEventListener("change", (e) => {
    const val = e.currentTarget.options[e.currentTarget.selectedIndex].value;
    const path = JSON.parse(e.currentTarget.name);
    setSetting(val, path).then(() => {
      location.href = location.href.replace(/#.*$/, "");
    });
  });
  findEl(el, ".-tree-show-c").addEventListener("change", (e) => {
    setSetting(e.currentTarget.checked, ["cms.frontend.2", "ui", "tree_show_c"])
      .then(() => {
        location.href = location.href.replace(/#.*$/, "");
      });
  });

});

onEl(".content-manager", (el) => {
  const pid = el.getAttribute("pid");
  const node = api.cms.node(pid);
  // change module
  findEl(el, ".-changemodule").addEventListener("change", (e) => {
    const val = e.currentTarget.options[e.currentTarget.selectedIndex].value;
    const type = el.getAttribute("page-type");
    node.module.put({ module: val }).then(() => {
      if (type === "p") location.href = location.href.replace(/#.*$/, "");
    });
    if (type !== "p") {
      node.html.get().then(html => { document.querySelector('[qcms-id="'+pid+'"]').outerHTML = html; });
      sidebar.set("settings");
    }
  });
  // parent
  const editparent = findEl(el, ".-editparent");
  editparent?.addEventListener("click", (e) => {
    const pid = e.currentTarget.getAttribute("parent");
    const type = e.currentTarget.getAttribute("page-type");
    if (type !== "p") {
      e.preventDefault();
      cms.cont.active = pid;
      sidebar.set("settings");
    }
  });
});
onEl(".superuser-manager", (el) => {
  const pid = el.getAttribute("pid");
  el.addEventListener("keyup", (e) => {
    if (e.key !== "Enter") return;
    const create = e.target.closest(".-create");
    if (!create) return;
    const scope = e.target.closest("[scope]").getAttribute("scope");
    loadWidget("superuser", { pid, create: create.value, in: scope });
  });
  el.addEventListener("click", async (e) => {
    const scopeEl = e.target.closest("[scope]");
    if (!scopeEl) return;
    const scope = scopeEl.getAttribute("scope");
    const remove = e.target.closest(".-remove");
    if (remove) {
      const file = remove.parentNode.getAttribute("itemid");
      if (await confirm(t`Really delete this file?`)) loadWidget("superuser", { pid, delete: file, in: scope });
    }
  });
});

if (!await ctx.settings["cms.frontend.2"].tour_seen) {
  import("./intro.mjs").then(({ start }) => start());
}
