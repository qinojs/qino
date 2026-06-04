import { itemJs } from "../../../core/pub/js/SettingsEditor.mjs";
import "./frontend.mjs";
import { apt } from "../../../core/pub/js/qino.js";
import { t } from "../../../core/pub/js/qino.js";

const U2 = "https://cdn.jsdelivr.net/gh/u2ui/u2@1.3.13/";
const panelTag = "qino-cms-panel";
const panelStyles = [
  "core/pub/css/c1/box.css",
  "cms.frontend.2/pub/css/main.css",
  "cms.frontend.2/pub/css/off.css",
  "cms.frontend.2/pub/css/panel.css",
  "cms.frontend.2/pub/css/tree.css",
];

customElements.define(panelTag, class extends HTMLElement {
  connectedCallback() {
    if (this.shadowRoot) return;
    const root = this.attachShadow({ mode: "open" });
    for (const href of panelStyles) root.append(Object.assign(document.createElement("link"), { rel: "stylesheet", href: sysURL + href }));
    while (this.firstChild) root.append(this.firstChild);
  }
});

const listeners = [];
let observer;
const on = (el, events, fn) => events.split(" ").forEach(e => el.addEventListener(e, fn));
const sel = s => s[0] === ">" ? ":scope " + s : s;
const findEl = (el, s) => el.querySelector(sel(s));
const findAll = (el, s) => el.querySelectorAll(sel(s));
function setHtml(el, html) {
  el.innerHTML = html;
  for (const old of el.querySelectorAll("script")) {
    console.warn("Script tag in CMS widget HTML", old);
    const s = document.createElement("script");
    s.async = false;
    for (const attr of old.attributes) s.setAttribute(attr.name, attr.value);
    s.textContent = old.textContent;
    old.replaceWith(s);
  }
}
function onEl(selector, fn) {
  const listener = { selector, fn, els: new WeakSet() };
  listeners.push(listener);
  check(listener, root);
  if (observer) return;
  observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType === 1) {
          for (const listener of listeners) check(listener, node);
        }
      }
    }
  });
  observer.observe(root, { childList: true, subtree: true });
}
function check(listener, target) {
  const els = [];
  target?.matches?.(listener.selector) && els.push(target);
  els.push(...target.querySelectorAll(listener.selector));
  for (const el of els) {
    if (listener.els.has(el)) continue;
    listener.els.add(el);
    requestAnimationFrame(() => listener.fn(el));
  }
}

function setSetting(value, path) {
  const p = Array.isArray(path) ? path : String(path || "").split("/").filter(Boolean);
  return apt.core["ctx-settings"](p).put({ value });
}

const { item, effect } = await itemJs;
const uiState = item(cmsFrontend2Data ?? {});
const sidebar = uiState.item("sidebar");
const widgets = uiState.item("widget");
if (!widgets.filled) widgets.set({});

cms.panel = { state: uiState, sidebar, widgets };
const el = document.querySelector(panelTag).shadowRoot.getElementById("panel");
const root = cms.panelRoot = el.getRootNode();

/* sidebar */
const loadWidget = (widget, params, cb) => {
  const widgetEl = findEl(el, '[widget="' + widget + '"]');
  if (!widgetEl) return;
  import("../../../core/pub/js/c1/loading.mjs").then(({ default: loading }) => {
    loading.mark(widgetEl);
    params ||= {};
    params.pid ||= cms.cont.active || Page; // neu
    apt['cms.frontend.2'].widget(widget).post({ params }).then((res) => {
      loading.done(widgetEl);
      setHtml(widgetEl, res);
      cb?.({ target: widgetEl });
    });
  });
};


uiState.addEventListener("changeIn", () => {
  setSetting(uiState.get({ silent: true }), ["cms.frontend.2", "custom"]); // why silent? should we debounce?
});

function syncSidebar(value = sidebar.value) {
  findAll(el, "> .-sidebar > .-item").forEach((el) => el.classList.remove("-open"));

  if (value) {
    const item = findEl(el, '> .-sidebar > .-item[itemid="' + value + '"]');
    if (!item) return;
    item.classList.add("-open");
    item.focus();

    el.c1ZTop();

    [
      ...document.querySelectorAll(".qgCMS_editmode_switch"),
      ...root.querySelectorAll(".qgCMS_editmode_switch"),
    ].forEach((item) => item.c1ZTop() );

    el.classList.add("-open");
    const content = findEl(el, '> .-sidebar > [itemid="' + value + '"] > .-content');
    if (!content) return;
    loadWidget(value, { pid: cms.cont.active || Page });
  } else {
    el.classList.remove("-open");
  }
}
effect(() => syncSidebar(sidebar.value));
sidebar.addEventListener("set", e => e.value === e.oldValue && syncSidebar(e.value));

el.addEventListener("click", (e) => {
  const titelEl = e.target.closest(".-sidebar > .-item > .-title");
  if (!titelEl) return;
  cms.cont.active = Page;
  sidebar.set(titelEl.closest("[itemid]").getAttribute("itemid"));
});

/* widgets */
widgets.addEventListener("setIn", e => {
  if (e.target.parent !== widgets) return;
  if (e.value) loadWidget(e.target.key, { pid: cms.cont.active || Page });
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
  const target = e.composedPath()[0]; // echtes Element auch innerhalb Shadow-DOM (e.target ist sonst der Host)
  if (target.getRootNode() !== document) return; // aus Shadow-DOM = Komponente (Tree/Panel/…) besitzt die Taste
  if (target.isContentEditable || target.form !== undefined) return; // Inputs/contenteditable im Light-DOM (Seiteninhalt)
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

apt.on("POST cms/node/:id/contents", () => sidebar.set(""));

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
    cms.console.show(t`Datei hochgeladen`);
    cms.cont(ev.pid).showWidget("media", true);
  });
});

apt.on("POST cms/node/:id/files", ({ params: { id } }) => {
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

!document.querySelector(".-e.qgCMS-dropTarget") &&
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
apt.on("PUT cms/node/:id/online-start", () => loadWidget("access.time.head"));
apt.on("PUT cms/node/:id/online-end",   () => loadWidget("access.time.head"));
apt.on("PUT cms/node/:id/access",       () => loadWidget("access.grp.head"));
apt.on("PUT cms/node/:id/access/groups/*", () => loadWidget("access.grp.head"));
apt.on("PUT cms/node/:id/access/users/*",  () => loadWidget("access.usr.head"));
apt.on("DELETE cms/node/:id/files/*",   () => loadWidget("media.head"));
apt.on("DELETE cms/node/:id/files/doubles", () => loadWidget("media.head"));
apt.on("DELETE cms/node/:id/files/all", () => loadWidget("media.head"));
apt.on("POST cms/node/:id/redirects",   () => loadWidget("urls.head"));
apt.on("DELETE cms/node/:id/redirects", () => loadWidget("urls.head"));

onEl(".tree-manager", async (el) => {
  await import("./tree.mjs");
  // add Page
  const inp = root.getElementById("page-add");
  function add() {
    const v = inp.value.trim();
    v && cms.Tree.addPage(v);
    inp.value = "";
  }
  inp.addEventListener("blur", (e) => {
    e.currentTarget.value && confirm(t`Create page "${e.currentTarget.value}"?`) ? add() : null;
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
  const node = apt.cms.node(pid);
  import("../../../core/pub/js/c1/form.mjs").then(() => {
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

    // DnD-Sortierung via u2-dropzone: tbody[u2-dropzone] + tr[draggable] (Template).
    // u2-draghandle (auf td.-handle) macht nur den Griff ziehbar. Nach dem Drop ist die
    // DOM-Reihenfolge die neue Sortierung -> an Server.
    import(U2 + "attr/dropzone/dropzone.js");
    import(U2 + "attr/draghandle/draghandle.js");
    tbody.addEventListener("u2-dropzone-drop", (e) => {
      if (!e.detail?.add) return; // gleiche Zone feuert remove+add -> nur einmal reagieren
      requestAnimationFrame(() => {
        const sort = Array.from(tbody.children).map((el) => el.getAttribute("itemid"));
        node.files.put({ sort });
      });
    });
    tbody.addEventListener("click", (e) => {
      const del = e.target.closest(".-delete");
      if (del) {
        const tr = del.closest("tr");
        confirm(t`Really delete this file?`) && node.files(tr.getAttribute("itemid")).delete().then(() => tr.remove());
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
    findEl(el, ".-deleteFilesSelect").addEventListener("change", (e) => {
      const val = e.currentTarget.options[e.currentTarget.selectedIndex].value;
      if (val === "double") node.files.doubles.delete().then(reload);
      if (val === "all" && confirm(t`Really delete all files?`)) node.files.all.delete().then(reload);
    });
  }
});
onEl(".module-manager", (el) => {
  import("../../../core/pub/js/c1/loading.mjs"); // preload

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
    import("../../../core/pub/js/c1/loading.mjs").then(({ default: loading }) => {
      loading.mark(box);
      if (box.closest(".add-models")) {
        apt.cms.node(itemid).copy.post().then(({ id }) => {
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
  const node = apt.cms.node(pid);
  findEl(el, ".-inherit").addEventListener("change", (e) => {
    const value = e.currentTarget.checked ? null : parseInt(e.currentTarget.value); // not inherit ? set it to what it was inherited
    node.access.put({ value });
    widgets.item("access.grp").set(1);
  });
  const searchInp = findEl(el, ".-search");
  searchInp?.addEventListener(
    "keyup",
    ((e) => {
      loadWidget("access.grp.list", { pid, search: e.target.value });
    }).c1Debounce(150),
  );
  // change grp access
  el.addEventListener("change", (e) => {
    const inp = e.target;
    if (!inp.closest('[widget="access.grp.list"]')) return;
    if (inp.name === "public") {
      node.access.put({ value: parseInt(inp.value) });
    } else {
      node.access.groups(inp.name.replace("g_", "")).put({ access: parseInt(inp.value) });
    }
  });
});
onEl(".access-users-manager", (el) => {
  const pid = el.getAttribute("pid");
  const node = apt.cms.node(pid);
  const searchInp = findEl(el, ".-search");
  searchInp?.addEventListener(
    "keyup",
    ((e) => {
      loadWidget("access.usr.list", { pid, search: e.target.value });
    }).c1Debounce(150),
  );
  // change usr access
  el.addEventListener("change", (e) => {
    const inp = e.target;
    if (!inp.closest('[widget="access.usr.list"]')) return;
    node.access.users(inp.name.replace("u_", "")).put({ access: parseInt(inp.value) });
  });
});
onEl(".access-time-manager", (el) => {
  const pid = el.getAttribute("pid");
  const node = apt.cms.node(pid);
  const reload = () => widgets.item("access.time").set(1);

  const inpStart = findEl(el, ".-start");
  inpStart.addEventListener("blur", () => {
    const value = inpStart.value;
    node["online-start"].put({ value });
    reload();
  });
  findEl(el, ".-start_always").addEventListener("click", () => {
    node["online-start"].put({ value: "0" });
    reload();
  });
  const startNow = findEl(el, ".-start_now");
  startNow.addEventListener("click", () => {
    node["online-start"].put({ value: String(Math.ceil(Date.now() / 1000)) });
    reload();
  });
  findEl(el, ".-start_inherit").addEventListener("click", () => {
    node["online-start"].put({ value: null });
    reload();
  });
  inpStart.style.display = inpStart.value ? "block" : "none";
  startNow.style.display = inpStart.value ? "none" : "block";

  const inpEnd = findEl(el, ".-end");
  inpEnd.addEventListener("blur", () => {
    const value = inpEnd.value;
    node["online-end"].put({ value });
    reload();
  });
  findEl(el, ".-end_always").addEventListener("click", () => {
    node["online-end"].put({ value: "0" });
    reload();
  });
  const endNow = findEl(el, ".-end_now");
  endNow.addEventListener("click", () => {
    node["online-end"].put({ value: String(Math.ceil(Date.now() / 1000)) });
    reload();
  });
  findEl(el, ".-end_inherit").addEventListener("click", () => {
    node["online-end"].put({ value: null });
    reload();
  });
  inpEnd.style.display = inpEnd.value ? "block" : "none";
  endNow.style.display = inpEnd.value ? "none" : "block";
});
onEl(".url-manager", (el) => {
  const pid = el.getAttribute("pid");
  const node = apt.cms.node(pid);
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
  addInp.addEventListener("keyup", ((e) => {
      apt.cms["request-used"].get({ url: e.target.value }).then(({ used }) => {
        e.target.style.border = used ? "1px solid red" : "1px solid green";
      });
    }).c1Debounce(200),
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
  const node = apt.cms.node(pid);
  findEl(el, ".-visible").addEventListener("change", (e) => {
    node.visible.put({ value: e.currentTarget.checked });
  });
  findEl(el, ".-searchable").addEventListener("change", (e) => {
    node.searchable.put({ value: e.currentTarget.checked });
  });
  findEl(el, ".-name").addEventListener(
    "input",
    ((e) => {
      node.name.put({ value: e.target.value });
    }).c1Debounce(400),
  );
  findEl(el, ".-name").addEventListener("change", (e) => {
    node.name.put({ value: e.currentTarget.value });
  });
  findEl(el, ".-model").addEventListener("change", (e) => {
    setSetting(e.currentTarget.value, e.currentTarget.name);
    loadWidget("divers", { pid });
  });
  findEl(el, ".-basis").addEventListener("blur", (e) => {
    e.currentTarget.value && apt.cms.node(String(e.currentTarget.value))["insert-before"].put({ id: String(pid) });
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
    apt.cms.node(e.currentTarget.dataset.pid).settings._seo_priority.put({ value: e.currentTarget.value });
  });
});
onEl(".more-manager", (el) => {
  // feedback-formular
  findEl(el, ".-feedbackform").addEventListener("submit", (e) => {
    e.preventDefault();
    loadWidget("more", {
      pid: Page,
      msg: findEl(e.currentTarget, "[name=msg]").value,
      link: location.href,
    });
  });
  findEl(el, ".-feedbackform [name=msg]").addEventListener(
    "input",
    ((e) => {
      setSetting(e.target.value, ["cms", "feedback", "text"]);
    }).c1Debounce(200),
  );
  // change password
  findEl(el, ".-pwchange").addEventListener("submit", (e) => {
    e.preventDefault();
    const oldpw = findEl(e.currentTarget, "[name=old]").value;
    const pw = findEl(e.currentTarget, "[name=new]").value;
    const pw2 = findEl(e.currentTarget, "[name=new2]").value;
    if (pw2 !== pw) alert(t`Passwords do not match`);
    else {
      apt.core.password.put({ oldpw, pw }).then((res) => {
        switch (res) {
          case 1:
            alert(t`Password changed successfully.`);
            break;
          case -1:
            alert(t`The old password is incorrect.`);
            break;
          case -2:
            alert(t`The password is too short.`);
            break;
        }
      });
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
    setSetting(e.currentTarget.checked, ["cms.frontend.2", "custom", "tree_show_c"])
      .then(() => {
        location.href = location.href.replace(/#.*$/, "");
      });
  });
  // show editables
  // findEl(el, '.-showEditables').addEventListener('mouseenter', e=>{
  // 	document.documentElement.classList.add('cmsShowEditables');
  // });
  // findEl(el, '.-showEditables').addEventListener('mouseleave', e=>{
  // 	document.documentElement.classList.remove('cmsShowEditables');
  // });
});

onEl(".content-manager", (el) => {
  const pid = el.getAttribute("pid");
  const node = apt.cms.node(pid);
  // change module
  findEl(el, ".-changemodule").addEventListener("change", (e) => {
    const val = e.currentTarget.options[e.currentTarget.selectedIndex].value;
    const type = el.getAttribute("page-type");
    node.module.put({ module: val }).then(() => {
      if (type === "p") location.href = location.href.replace(/#.*$/, "");
    });
    if (type !== "p") {
      node.html.get().then(html => { document.querySelector('.-pid'+pid).outerHTML = html; });
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
  el.addEventListener("click", (e) => {
    const scopeEl = e.target.closest("[scope]");
    if (!scopeEl) return;
    //const scope = scopeEl.getAttribute('scope');
    const remove = e.target.closest(".-remove");
    if (remove) {
      const file = remove.parentNode.getAttribute("itemid");
      confirm(t`Really delete this file?`) && loadWidget("superuser", { pid, delete: file });
    }
  });
});
