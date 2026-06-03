import "../../../core/pub/js/SettingsEditor.mjs";
import "./frontend.mjs";
import { apt } from "../../../core/pub/js/qino.js";
import { t } from "../../../core/pub/js/qino.js";

function setCtxSetting(value, path) {
  const p = Array.isArray(path) ? path : String(path || "").split("/").filter(Boolean);
  return apt.core["ctx-settings"](p).put({ value });
}

document.addEventListener("DOMContentLoaded", function () {
  const panel = cms.panel = new xCollection(cmsFrontend1Data);
  const el = document.getElementById("qgCmsFrontend1");

  /* sidebar */
  panel.loadWidget = (widget, params, cb) => {
    const widgetEl = el.c1Find('[widget="' + widget + '"]');
    if (!widgetEl) return;
    import("../../../core/pub/js/c1/loading.mjs").then(({ default: loading }) => {
      loading.mark(widgetEl);
      params ||= {};
      params.pid ||= cms.cont.active || Page; // neu
      apt['cms.frontend.1'].widget(widget).post({ params }).then((res) => {
        loading.done(widgetEl);
        //widgetEl.innerHTML = res; // scripts are not executed :(
        $(widgetEl).html(res);
        cb?.({ target: $(widgetEl) });
      });
    });
  };
  panel.on("set", function (e) {
    e.old !== e.value &&
      setCtxSetting(this.getAll(), ["cms.frontend.1", "custom"]);
    if (e.name === "sidebar") {
      el.c1FindAll("> .-sidebar > .-item").forEach((el) =>
        el.classList.remove("-open")
      );

      if (e.value) {
        const item = el.c1Find('> .-sidebar > .-item[itemid="' + e.value + '"]');
        item.classList.add("-open");
        item.focus();

        el.c1ZTop();

        document.querySelectorAll(".qgCMS_editmode_switch").forEach((item) => item.c1ZTop() );

        el.classList.add("-open");
        const load = el.c1Find('> .-sidebar > [itemid="' + e.value + '"] > .-content').getAttribute("widget");
        load && panel.loadWidget(e.value, { pid: cms.cont.active || Page });
      } else {
        el.classList.remove("-open");
      }
    }
  });

  function titleDown(e) {
    if (e.type === "mousedown" && e.button !== 0) return;
    const titelEl = e.target.closest(".-sidebar > .-item > .-title");
    if (!titelEl) return;
    cms.cont.active = Page;
    const sidebar = titelEl.closest("[itemid]").getAttribute("itemid");
    panel.set("sidebar", sidebar);
  }
  el.addEventListener("mousedown", titleDown);
  el.addEventListener("touchstart", titleDown);

  /* widgets */
  panel.get("widget").on("set", function (e) {
    setCtxSetting(this.getAll(), ["cms.frontend.1", "custom", "widget"]);
    if (e.value) {
      panel.loadWidget(e.name, { pid: cms.cont.active || Page });
    } else {
      this.innerHTML = "";
    }
  });
  el.addEventListener("mousedown", (e) => {
    if (e.button !== 0) return;
    const wHead = e.target.closest(".-widgetHead");
    if (!wHead) return;
    e.preventDefault();
    const value = wHead.classList.toggle("-open");
    const widget = wHead.nextElementSibling.getAttribute("widget");
    if (!widget) return;
    panel.get("widget").set(widget, value);
  });

  function enterSensor() {
    el.classList.add("-sidebar-open");
  }
  el.c1Find("> .-sidebar > .-sensor").addEventListener("mouseenter",enterSensor);
  el.c1Find("> .-sidebar > .-sensor").addEventListener("touchstart",enterSensor);

  function outsideDown(e) {
    if (e.type === "mousedown" && e.button !== 0) return;
    if (el.children[0] !== e.target && el.contains(e.target)) return;
    el.classList.remove("-sidebar-open");
    panel.set("sidebar", "");
  }
  document.addEventListener("mousedown", outsideDown);
  document.addEventListener("touchstart", outsideDown);

  // shortcuts
  document.addEventListener("keydown", (e) => {
    const target = e.composedPath()[0]; // echtes Element auch innerhalb Shadow-DOM (e.target ist sonst der Host)
    if (target.getRootNode() !== document) return; // aus Shadow-DOM = Komponente (Tree/Panel/…) besitzt die Taste
    if (target.isContentEditable || target.form !== undefined) return; // Inputs/contenteditable im Light-DOM (Seiteninhalt)
    if (e.shiftKey || e.metaKey || e.altKey || e.ctrlKey) return;

    if (e.key == "t") {
      cms.cont.active = cms.contPos.active?.pid;
      cms.panel.set("sidebar", "tree");
      e.preventDefault();
    }
    if (e.key == " ") {
      cms.cont.active = cms.contPos.active?.pid;
      cms.panel.set("sidebar", "settings");
      e.preventDefault();
    }
    if (e.key == "v") {
      cms.panel.toggle("sidebar", "add");
      setTimeout(() => {
        const inp = el.c1Find('[widget="add"] .-h1 > input');
        inp?.focus();
      }, 700);
    }
    if (e.key == "Escape") {
      cms.panel.set("sidebar", "");
    }
    if (e.key == "n") { // n
      cms.panel.set("sidebar", "tree");
      setTimeout(() => {
        const inp = el.c1Find("#cmsPageAddInp");
        inp?.focus();
      }, 700);
    }
  });

  apt.on("POST cms/node/:id/contents", () => cms.panel.set("sidebar", ""));

  cms.cont.on("upload", (ev) => {
    cms.cont(ev.pid).showWidget("media");
    ev.on("progress", (e) => {
      const percent = Math.round(e.loaded * 100 / e.total);
      const button = el.c1Find('[cmsconf="contMedia_overview"] button');
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
        cms.cont.active == this.id && what === cms.panel.get("widget").get(what)
      ) return;
    }
    cms.cont.active = this.id;
    cms.panel.get("widget").set(what, 1);
    cms.panel.set("sidebar", "settings");
    cms.Tree?.goTo(this.id);
  };

  !document.querySelector(".-e.qgCMS-dropTarget") &&
    el.c1Find("> .-sidebar > [itemid=add]").setAttribute("hidden", "hidden");

  const switches = document.querySelectorAll(".qgCMS_editmode_switch");
  function enter() {
    el.classList.add("-open", "-sidebar-open");
  }
  for (const switc of switches) {
    switc.addEventListener("mouseenter", enter);
    switc.addEventListener("touchstart", enter);
  }

  /* update accordion-heads */
  apt.on("PUT cms/node/:id/online-start", () => panel.loadWidget("access.time.head"));
  apt.on("PUT cms/node/:id/online-end",   () => panel.loadWidget("access.time.head"));
  apt.on("PUT cms/node/:id/access",       () => panel.loadWidget("access.grp.head"));
  apt.on("PUT cms/node/:id/access/groups/*", () => panel.loadWidget("access.grp.head"));
  apt.on("PUT cms/node/:id/access/users/*",  () => panel.loadWidget("access.usr.head"));
  apt.on("DELETE cms/node/:id/files/*",   () => panel.loadWidget("media.head"));
  apt.on("DELETE cms/node/:id/files/doubles", () => panel.loadWidget("media.head"));
  apt.on("DELETE cms/node/:id/files/all", () => panel.loadWidget("media.head"));
  apt.on("POST cms/node/:id/redirects",   () => panel.loadWidget("urls.head"));
  apt.on("DELETE cms/node/:id/redirects", () => panel.loadWidget("urls.head"));
});

c1.onElement(".qgCmsTreeManager", async (el) => {
  await import("./tree.mjs");
  // add Page
  const inp = document.getElementById("cmsPageAddInp");
  function add() {
    const v = inp.value.trim();
    v && cms.Tree.addPage(v);
    inp.value = "";
  }
  inp.addEventListener("blur", function () {
    this.value &&
      confirm(t`Create page "${this.value}"?`)
      ? add()
      : null;
  });
  inp.addEventListener("keydown", function (e) {
    e.key === "Enter" && add();
    if (e.key === "Escape") {
      this.value = "";
      this.blur();
    }
  });
  const tree = JSON.parse(el.getAttribute("data"));
  await cmsTreeInit(tree);
  // change placeholder
  const old = cms.Tree.options.onActivate;
  cms.Tree.options.onActivate = function (node) {
    inp.placeholder = inp.placeholder.replace(/"([^"]*)"/, `"${node.data.title}"`);
    old.apply(this, arguments);
  };
  /* go to hash-url  if (!isset(G()->ASK['serverInterface']) && G()->SET['cms.frontend.1']['custom']['tree_show_c']->v) { ?>
	setTimeout(function(){
		var to = location.hash.match(/cmspid([0-9]+)/);
		to && cms.Tree.goTo(to[1]);
	})
	} */
});

c1.onElement(".qgCmsFileManager", (el) => {
  const pid = el.getAttribute("pid");
  import("../../../core/pub/js/c1/form.mjs").then(() => {
    el.c1Find(".-uploadBtn").addEventListener("click", async function () {
      const files = await c1.form.fileDialog();
      upload(files);
    });
  });
  const tbody = el.c1Find("tbody");
  if (tbody) {
    for (const tr of tbody.children) {
      const img = tr.querySelector(".-preview > img");
      let f = 1, oW, oH;
      if (!img) continue;
      img.parentNode.addEventListener("wheel", function (e) {
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

    $(tbody).sortable({
      handle: ".-handle",
      axis: "y",
      stop() {
        const sort = Array.from(tbody.children).map((el) =>
          el.getAttribute("itemid")
        );
        apt.cms.node(pid).files.put({ sort });
      },
    });
    tbody.addEventListener("click", (e) => {
      const del = e.target.closest(".-delete");
      if (del) {
        const tr = del.closest("tr");
        confirm(t`Really delete this file?`) &&
          apt.cms.node(pid).files(tr.getAttribute("itemid")).delete().then(() => tr.remove());
        return;
      }
      const preview = e.target.closest(".-preview");
      if (preview) {
        const replaces = preview.closest("tr").getAttribute("itemid");
        c1.form.fileDialog({ multiple: false }).then((files) =>
          upload(files, replaces)
        );
      }
    });
    tbody.addEventListener("dragstart", (e) => {
      const link = e.target.closest(".-preview > [draggable], .-link > a");
      if (link) {
        cms.panel.set("sidebar", "");
      }
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
    cms.panel.get("widget").set("media", 1);
  };
  el.c1Find(".-addExistingFile").addEventListener(
    "select_by_pointer",
    function () { this.value && apt.cms.node(pid).files.post({ file: this.value }); },
  );
  if (el.c1Find(".-sortFilesSelect")) {
    el.c1Find(".-sortFilesSelect").addEventListener("change", function () {
      this.value && apt.cms.node(pid).files.order.post({ by: this.value }).then(reload);
    });
    el.c1Find(".-deleteFilesSelect").addEventListener("change", function () {
      const val = this.options[this.selectedIndex].value;
      if (val === "double") apt.cms.node(pid).files.doubles.delete().then(reload);
      if (val === "all" && confirm(t`Really delete all files?`)) apt.cms.node(pid).files.all.delete().then(reload);
    });
  }
});
c1.onElement(".qgCmsFront1ModuleManager", (el) => {
  import("../../../core/pub/js/c1/loading.mjs"); // preload

  const searchInp = el.c1Find("input");
  searchInp.addEventListener("input", function () {
    for (const box of el.c1FindAll(".-module-boxes > *")) {
      box.style.display =
        box.textContent.toLowerCase().match(this.value.toLowerCase())
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
      if (box.closest(".cmsAddModels")) {
        apt.cms.node(itemid).copy.post().then(({ id }) => {
          cms.panel.set("sidebar", "");
          cms.cont(id).addPosition();
        });
      } else {
        cms.cont.add(itemid);
      }
    });
    e.preventDefault();
  });
});
c1.onElement(".qgCmsFront1AccessGrpManager", (el) => {
  const pid = el.getAttribute("pid");
  el.c1Find(".-inherit").addEventListener("change", function () {
    const value = this.checked ? null : parseInt(this.value); // not inherit ? set it to what it was inherited
    apt.cms.node(pid).access.put({ value });
    cms.panel.get("widget").set("access.grp", 1);
  });
  const searchInp = el.c1Find(".-search");
  searchInp?.addEventListener(
    "keyup",
    function () {
      cms.panel.loadWidget("access.grp.list", { pid, search: this.value });
    }.c1Debounce(150),
  );
  // change grp access
  el.addEventListener("change", (e) => {
    const inp = e.target;
    if (!inp.closest('[widget="access.grp.list"]')) return;
    if (inp.name === "public") {
      apt.cms.node(pid).access.put({ value: parseInt(inp.value) });
    } else {
      apt.cms.node(pid).access.groups(inp.name.replace("g_", "")).put({ access: parseInt(inp.value) });
    }
  });
});
c1.onElement(".qgCmsFront1AccessUsrManager", (el) => {
  const pid = el.getAttribute("pid");
  const searchInp = el.c1Find(".-search");
  searchInp?.addEventListener(
    "keyup",
    function () {
      cms.panel.loadWidget("access.usr.list", { pid, search: this.value });
    }.c1Debounce(150),
  );
  // change usr access
  el.addEventListener("change", (e) => {
    const inp = e.target;
    if (!inp.closest('[widget="access.usr.list"]')) return;
    apt.cms.node(pid).access.users(inp.name.replace("u_", "")).put({ access: parseInt(inp.value) });
  });
});
c1.onElement(".qgCmsFront1AccessTimeManager", (el) => {
  const pid = el.getAttribute("pid");

  const inpStart = el.c1Find(".-start");
  inpStart.addEventListener("blur", () => {
    const value = inpStart.value;
    apt.cms.node(pid)["online-start"].put({ value });
    cms.panel.get("widget").set("access.time", 1);
  });
  el.c1Find(".-start_always").addEventListener("click", () => {
    apt.cms.node(pid)["online-start"].put({ value: "0" });
    cms.panel.get("widget").set("access.time", 1);
  });
  const startNow = el.c1Find(".-start_now");
  startNow.addEventListener("click", () => {
    apt.cms.node(pid)["online-start"].put({ value: String(Math.ceil(Date.now() / 1000)) });
    cms.panel.get("widget").set("access.time", 1);
  });
  el.c1Find(".-start_inherit").addEventListener("click", () => {
    apt.cms.node(pid)["online-start"].put({ value: null });
    cms.panel.get("widget").set("access.time", 1);
  });
  inpStart.style.display = inpStart.value ? "block" : "none";
  startNow.style.display = inpStart.value ? "none" : "block";

  const inpEnd = el.c1Find(".-end");
  inpEnd.addEventListener("blur", () => {
    const value = inpEnd.value;
    apt.cms.node(pid)["online-end"].put({ value });
    cms.panel.get("widget").set("access.time", 1);
  });
  el.c1Find(".-end_always").addEventListener("click", () => {
    apt.cms.node(pid)["online-end"].put({ value: "0" });
    cms.panel.get("widget").set("access.time", 1);
  });
  const endNow = el.c1Find(".-end_now");
  endNow.addEventListener("click", () => {
    apt.cms.node(pid)["online-end"].put({ value: String(Math.ceil(Date.now() / 1000)) });
    cms.panel.get("widget").set("access.time", 1);
  });
  el.c1Find(".-end_inherit").addEventListener("click", () => {
    apt.cms.node(pid)["online-end"].put({ value: null });
    cms.panel.get("widget").set("access.time", 1);
  });
  inpEnd.style.display = inpEnd.value ? "block" : "none";
  endNow.style.display = inpEnd.value ? "none" : "block";
});
c1.onElement(".qgCmsFront1UrlManager", (el) => {
  const pid = el.getAttribute("pid");
  el.c1Find("> .-urls").addEventListener("change", (e) => {
    const tr = e.target.closest("[data-lang]");
    const lang = tr.getAttribute("data-lang");

    let inp = e.target.closest(".-target");
    if (inp) {
      apt.cms.node(pid).urls(lang).target.put({ value: inp.checked ? "_blank" : "" });
    }
    inp = e.target.closest(".-url");
    if (inp) {
      apt.cms.node(pid).urls(lang).put({ url: inp.value });
      tr.c1Find(".-custom").checked = true;
    }
    inp = e.target.closest(".-custom");
    if (inp) {
      apt.cms.node(pid).urls(lang).custom.delete().then(url => {
        tr.c1Find(".-url").value = url;
      });
    }
  });
  el.c1Find("> .-directlinks").addEventListener("click", (e) => {
    const del = e.target.closest(".-delete");
    if (!del) return;
    const tr = del.closest("[itemid]");
    const v = tr.getAttribute("itemid");
    tr.remove();
    apt.cms.node(pid).redirects.delete({ url: v });
  });

  const addInp = el.c1Find(".-add_inp");
  addInp.addEventListener(
    "keyup",
    function () {
      apt.cms["request-used"].get({ url: this.value }).then(({ used }) => {
        this.style.border = used ? "1px solid red" : "1px solid green";
      });
    }.c1Debounce(200),
  );
  addInp.addEventListener("keydown", (e) => {
    e.key === "Enter" && cmsRequestSet();
  });
  el.c1Find(".-add").addEventListener("click", cmsRequestSet);

  function cmsRequestSet() {
    const v = addInp.value;
    apt.cms.node(pid).redirects.post({ url: v });
    cms.panel.get("widget").set("urls", 1);
  }
});
c1.onElement(".qgCmsFront1DiversManager", (el) => {
  const pid = el.getAttribute("pid");
  el.c1Find(".-visible").addEventListener("change", function () {
    apt.cms.node(pid).visible.put({ value: this.checked });
  });
  el.c1Find(".-searchable").addEventListener("change", function () {
    apt.cms.node(pid).searchable.put({ value: this.checked });
  });
  el.c1Find(".-name").addEventListener(
    "input",
    function () {
      apt.cms.node(pid).name.put({ value: this.value });
    }.c1Debounce(400),
  );
  el.c1Find(".-name").addEventListener("change", function () {
    apt.cms.node(pid).name.put({ value: this.value });
  });
  el.c1Find(".-model").addEventListener("change", function () {
    setCtxSetting(this.value, this.name);
    cms.panel.loadWidget("divers", { pid });
  });
  el.c1Find(".-basis").addEventListener("blur", function () {
    this.value && apt.cms.node(String(this.value))["insert-before"].put({ id: String(pid) });
  });
  el.c1Find(".-childXML").addEventListener("change", function () {
    apt.cms.node(pid).settings.childXML.put({ value: this.value });
  });
});
c1.onElement(".qgCmsFront1SeoManager", (el) => {
  const desc = el.c1Find(".-desc");
  function checkTextarea(el) {
    el.classList.toggle("-invalid", !/^.{60,156}$/.test(el.value));
  }
  desc.addEventListener("input", function () { checkTextarea(this); });
  checkTextarea(desc);
  el.c1Find(".-seo-prio").addEventListener("change", function () {
    apt.cms.node(this.dataset.pid).settings._seo_priority.put({ value: this.value });
  });
});
c1.onElement(".qgCmsFront1MoreManager", (el) => {
  // feedback-formular
  el.c1Find(".-feedbackform").addEventListener("submit", function (e) {
    e.preventDefault();
    cms.panel.loadWidget("more", {
      pid: Page,
      msg: this.c1Find("[name=msg]").value,
      link: location.href,
    });
  });
  el.c1Find(".-feedbackform [name=msg]").addEventListener(
    "input",
    function () {
      setCtxSetting(this.value, ["cms", "feedback", "text"]);
    }.c1Debounce(200),
  );
  // change password
  el.c1Find(".-pwchange").addEventListener("submit", function (e) {
    e.preventDefault();
    const oldpw = this.c1Find("[name=old]").value;
    const pw = this.c1Find("[name=new]").value;
    const pw2 = this.c1Find("[name=new2]").value;
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
  el.c1Find(".-changelang").addEventListener("change", function (e) {
    const val = this.options[this.selectedIndex].value;
    const path = JSON.parse(this.name);
    setCtxSetting(val, path).then(() => {
      location.href = location.href.replace(/#.*$/, "");
    });
  });
  el.c1Find(".-tree-show-c").addEventListener("change", function (e) {
    setCtxSetting(this.checked, ["cms.frontend.1", "custom", "tree_show_c"])
      .then(() => {
        location.href = location.href.replace(/#.*$/, "");
      });
  });
  // show editables
  // el.c1Find('.-showEditables').addEventListener('mouseenter', e=>{
  // 	document.documentElement.classList.add('cmsShowEditables');
  // });
  // el.c1Find('.-showEditables').addEventListener('mouseleave', e=>{
  // 	document.documentElement.classList.remove('cmsShowEditables');
  // });
});

c1.onElement(".qgCMSFron1ContManager", (el) => {
  const pid = el.getAttribute("pid");
  // change module
  el.c1Find(".-changemodule").addEventListener("change", function (e) {
    const val = this.options[this.selectedIndex].value;
    const type = el.getAttribute("page-type");
    apt.cms.node(pid).module.put({ module: val }).then(() => {
      if (type === "p") location.href = location.href.replace(/#.*$/, "");
    });
    if (type !== "p") {
      apt.cms.node(pid).html.get().then(html => { document.querySelector('.-pid'+pid).outerHTML = html; });
      cms.panel.set("sidebar", "settings");
    }
  });
  // parent
  const editparent = el.c1Find(".-editparent");
  editparent?.addEventListener("click", function (e) {
    const pid = this.getAttribute("parent");
    const type = this.getAttribute("page-type");
    if (type !== "p") {
      e.preventDefault();
      cms.cont.active = pid;
      cms.panel.set("sidebar", "settings");
    }
  });
});
c1.onElement(".qgCmsFront1SuperuserManager", (el) => {
  const pid = el.getAttribute("pid");
  el.addEventListener("keyup", (e) => {
    if (e.key !== "Enter") return;
    const create = e.target.closest(".-create");
    if (!create) return;
    const scope = e.target.closest("[scope]").getAttribute("scope");
    cms.panel.loadWidget("superuser", { pid, create: create.value, in: scope });
  });
  el.addEventListener("click", (e) => {
    const scopeEl = e.target.closest("[scope]");
    if (!scopeEl) return;
    //const scope = scopeEl.getAttribute('scope');
    const remove = e.target.closest(".-remove");
    if (remove) {
      const file = remove.parentNode.getAttribute("itemid");
      confirm(t`Really delete this file?`) &&
        cms.panel.loadWidget("superuser", { pid, delete: file });
    }
  });
});

apt.on("PUT|PATCH|DELETE cms/node/:id/*", async ({ params: { id } }) => {
  cms.reloadNode(id);
});

/* xCollection */
function xCollection(obj) {
  this.data = {};
  obj && this.set(obj);
}
Object.assign(xCollection.prototype, c1.Eventer);
Object.assign(xCollection.prototype, {
  set(n, v) {
    if (typeof n === "object") {
      for (const key in n) {
        Object.hasOwn(n, key) && this.set(key, n[key]);
      }
      return;
    }
    const old_value = this.data[n];
    if (typeof v === "object") {
      this.data[n] = new xCollection(v);
    } else {
      this.data[n] = v;
    }
    this.trigger("set", { name: n, value: v, old: old_value });
  },
  get(n) {
    return this.data[n];
  },
  toggle(n, v1, v2 = "") {
    this.set(n, this.data[n] === v1 ? v2 : v1);
  },
  getAll() {
    const ret = {};
    for (const key in this.data) {
      if (this.data[key] instanceof xCollection) {
        ret[key] = this.data[key].getAll();
      } else {
        ret[key] = this.data[key];
      }
    }
    return ret;
  },
});
