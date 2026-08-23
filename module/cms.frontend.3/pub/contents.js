import "@qino/pub/c1/Placer.mjs";

import { api, cms, fileData, h, t } from "./cms.js";
import { contentDrag } from "./content-dnd.js";

const NODE = "[qcms-id]";
const EDIT = "[qcms-edit]";
const ZONE = "[qcms-drop][qcms-edit]";
const nodeId = el => Number(el?.closest?.(NODE)?.getAttribute("qcms-id"));

export async function initContents(root) {
  const [settingsLabel, moveLabel, offlineLabel, deleteLabel] = await Promise.all([
    t`Settings`, t`Move`, t`Offline`, t`Delete`,
  ]);
  const settings = h("button", { type: "button", class: "-opts", title: settingsLabel, "aria-label": settingsLabel });
  const drag = h("button", { type: "button", class: "-drag", title: moveLabel, "aria-label": moveLabel });
  const offline = h("span", { class: "-offline", title: offlineLabel, "aria-label": offlineLabel }, "●");
  const moduleName = h("span");
  const module = h("span", { class: "-mod" }, moduleName, offline);
  const menu = h("div", { id: "qgCmsContPosMenu", popover: "manual" }, settings, drag, module);
  const trash = h("div", { id: "qgCmsContTrash", popover: "manual", "aria-label": deleteLabel });
  const placer = new c1.Placer(menu, { x: "prepend", y: "before", margin: { top: 1, left: 4, bottom: 1, right: 0 } });
  const positions = new WeakMap();
  let leaveTimer;

  root.append(menu, trash);

  const hide = () => {
    clearTimeout(leaveTimer);
    menu.matches(":popover-open") && menu.hidePopover();
    cms.contPos.active?.el.removeAttribute("data-cms-active");
    cms.contPos.active = null;
  };
  const show = pos => {
    clearTimeout(leaveTimer);
    if (cms.contPos.moving) return;
    if (cms.contPos.active !== pos) {
      cms.contPos.active?.el.removeAttribute("data-cms-active");
      cms.contPos.active = pos;
      pos.el.setAttribute("data-cms-active", "");
    }
    const mod = pos.el.getAttribute("qcms-mod") || "CMS";
    moduleName.textContent = mod.replace(/^(cms\.)?cont\./, "");
    module.title = `${mod} (${pos.pid})`;
    drag.hidden = !pos.isDraggable();
    settings.hidden = !pos.el.hasAttribute("qcms-edit");
    offline.hidden = !pos.el.hasAttribute("qcms-offline");
    menu.style.cursor = pos.isDraggable() ? "move" : "default";
    menu.style.backgroundColor = getComputedStyle(pos.el).outlineColor;
    if (!menu.matches(":popover-open")) menu.showPopover();
    placer.follow(pos.el);
  };

  function contPos(el) {
    let pos = positions.get(el);
    if (pos) return pos;
    pos = {
      el,
      pid: nodeId(el),
      isDraggable: () => el.classList.contains("-draggable") || el.parentElement?.matches(ZONE),
      mark: event => {
        event?.stopPropagation();
        show(pos);
      },
      unmark: hide,
      unmarkDelay: () => {
        clearTimeout(leaveTimer);
        leaveTimer = setTimeout(hide, 100);
      },
    };
    positions.set(el, pos);
    el.addEventListener("mouseleave", pos.unmarkDelay);
    return pos;
  }
  contPos.active = null;
  contPos.moving = false;
  cms.contPos = contPos;

  const restore = ({ el, original }) => original.parent.insertBefore(el, original.next);
  const dd = contentDrag({
    onStart({ el }) {
      cms.contPos.moving = true;
      dd.targets = [...document.querySelectorAll(ZONE), trash];
      document.querySelectorAll("[qcms-drop]").forEach(el => el.setAttribute("data-cms-drop", ""));
      el.setAttribute("data-cms-moving", "");
      menu.matches(":popover-open") && menu.hidePopover();
      trash.showPopover();
    },
    onChange({ parent }) {
      trash.toggleAttribute("data-cms-full", parent === trash);
    },
    async onStop(detail) {
      const { el, original, parent } = detail;
      document.querySelectorAll("[data-cms-drop]").forEach(el => el.removeAttribute("data-cms-drop"));
      el.removeAttribute("data-cms-moving");
      trash.removeAttribute("data-cms-full");
      trash.matches(":popover-open") && trash.hidePopover();
      cms.contPos.moving = false;
      try {
        if (parent === trash) {
          const result = await api.cms.node(nodeId(el)).delete();
          el.remove();
          hide();
          if (nodeId(el) === globalThis.qino.cms.nodeId && result.parent_id) {
            const url = new URL(location.href);
            url.searchParams.set("cmspid", result.parent_id);
            location.href = url;
          }
          return;
        }
        const parentId = nodeId(parent);
        if (!parentId) return restore(detail);
        let before = el.nextElementSibling;
        while (before && !before.matches(NODE)) before = before.nextElementSibling;
        await api.cms.node(parentId)["insert-before"].put({
          id: String(nodeId(el)),
          before: before ? String(nodeId(before)) : undefined,
        });
        contPos(el).mark();
      } catch (error) {
        restore({ el, original });
        contPos(el).mark();
        await cms.dialogs.alert(error?.message || String(error));
      }
    },
  });
  contPos.dd = dd;

  const add = async id => {
    const template = document.createElement("template");
    template.innerHTML = await api.cms.node(id).html.get();
    const el = template.content.firstElementChild;
    if (!el) throw new TypeError(`Node ${id} rendered no element`);
    dd.start(el);
    return el;
  };
  const clipboard = async id => {
    const old = [...document.querySelectorAll(`[qcms-id="${CSS.escape(String(id))}"]`)];
    old.forEach(el => el.setAttribute("data-cms-cut", ""));
    if (!await cms.dialogs.confirm(t`Paste cut content on this page?`)) return;
    const el = await add(id);
    old.forEach(el => el.remove());
    el.removeAttribute("data-cms-cut");
    await api.cms.clipboard.put({ value: 0 });
  };

  const target = event => event.composedPath().find(part => part instanceof Element && part.closest?.(EDIT))?.closest(EDIT);
  const mark = event => {
    const el = target(event);
    if (el) contPos(el).mark(event);
  };
  document.addEventListener("mouseover", mark);
  document.addEventListener("dragenter", mark);
  document.addEventListener("mousedown", mark);
  document.addEventListener("cms:select", event => {
    const el = document.querySelector(`[qcms-id="${CSS.escape(String(event.detail.id))}"]`);
    if (el) contPos(el).mark();
  });
  settings.addEventListener("click", () => cms.select(cms.contPos.active?.pid));
  menu.addEventListener("mouseenter", event => cms.contPos.active?.mark(event));
  menu.addEventListener("mouseleave", () => cms.contPos.active?.unmarkDelay());
  for (const type of ["click", "mousedown"]) menu.addEventListener(type, event => event.stopPropagation());

  let startX, startY, moving;
  const stop = () => {
    document.removeEventListener("mousemove", move);
    document.removeEventListener("mouseup", stop);
  };
  const move = event => {
    if (event.ctrlKey) {
      api.cms.node(nodeId(moving)).copy.post().then(({ id }) => add(id));
    } else {
      if (Math.max(Math.abs(startX - event.clientX), Math.abs(startY - event.clientY)) < 6) return;
      dd.start(moving, event);
    }
    stop();
  };
  menu.addEventListener("mousedown", event => {
    if (event.button !== 0) return;
    const pos = cms.contPos.active;
    if (!pos?.isDraggable()) return;
    moving = pos.el;
    startX = event.clientX;
    startY = event.clientY;
    document.addEventListener("mousemove", move);
    document.addEventListener("mouseup", stop);
    event.preventDefault();
  });

  const activate = el => el && contPos(el).mark();
  cms.contents = {
    activate, add, clear: hide, clipboard,
    move: el => el && dd.start(el),
    get active() { return cms.contPos.active?.el; },
  };
  const all = Object.create(null);
  const content = id => ({
    id,
    addPosition: () => cms.contents.add(id),
    async upload(file, complete, replace) {
      const result = await api.cms.node(id).files.post({ file: await fileData(file), replace: replace || undefined });
      complete?.(result);
      return result;
    },
    showWidget(name) {
      cms.select(id);
      const widget = cms.panel?.widgets?.[name === "media" ? "media" : "settings"];
      const open = () => {
        const details = widget?.querySelector("details");
        if (details) details.open = true;
      };
      open();
      widget?.addEventListener("load", open, { once: true });
    },
  });
  cms.cont = Object.assign(id => {
    id = Number(id);
    return all[id] ||= content(id);
  }, {
    active: Number(cms.selected || globalThis.qino.cms.nodeId),
    all,
    add: module => api.cms.node(globalThis.qino.cms.nodeId).contents.post({ module }).then(({ id }) => cms.contents.add(id)),
  });
  return cms.contents;
}
