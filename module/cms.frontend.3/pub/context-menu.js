import "@qino/pub/c1/contextMenu.mjs";

import { api, cms, t } from "./cms.js";

const SELECTOR = "[qcms-edit], #qgCmsContPosMenu";
const icon = name => new URL(`./img/${name}.svg`, import.meta.url).href;
const nodeId = el => Number(el?.closest?.("[qcms-id]")?.getAttribute("qcms-id"));
const active = el => el?.id === "qgCmsContPosMenu" ? cms.contents?.active : el;

export const contextMenu = cms.contextMenu = cms.contextMenueContent = c1.globalContextMenu.addMenu(t`CMS Block`, {
  icon: new URL("./module.svg", import.meta.url).href,
  selector: SELECTOR,
  onshow(event) {
    const el = active(event.currentTarget);
    if (!el) return;
    if (cms.contents) return cms.contents.activate(el);
    const pid = nodeId(el);
    cms.contPos ??= {};
    cms.contPos.active = {
      el,
      pid,
      isDraggable: () => false,
      mark: () => el.setAttribute("data-cms-active", ""),
    };
  },
});

export function initContextMenu() {
  const add = (label, image, run, enabled) => contextMenu.addItem(label, {
    icon: icon(image),
    selector: SELECTOR,
    onshow(event) {
      this.activeEl = active(event.currentTarget);
      this.activeId = nodeId(this.activeEl);
      this.disabled = enabled && !enabled(this.activeEl);
    },
    async onclick() {
      try { await run(this.activeId, this.activeEl); }
      catch (error) { await cms.dialogs.alert(error?.message || String(error)); }
    },
  });

  add(t`Settings`, "settings", id => cms.select(id));
  add(t`Move`, "move", (_id, el) => cms.contents.move(el), el => cms.contPos(el).isDraggable());
  add(t`Copy`, "copy", async id => {
    const { id: copy } = await api.cms.node(id).copy.post();
    await cms.contents.add(copy);
  });
  add(t`Cut`, "cut", async id => {
    await api.cms.clipboard.put({ value: id });
    document.querySelectorAll("[data-cms-cut]").forEach(el => el.removeAttribute("data-cms-cut"));
    document.querySelectorAll(`[qcms-id="${CSS.escape(String(id))}"]`).forEach(el => el.setAttribute("data-cms-cut", ""));
  });
  add(t`Delete`, "delete", async id => {
    if (!await cms.dialogs.confirm(t`Really delete this content?`)) return;
    const result = await api.cms.node(id).delete();
    if (id === globalThis.qino.cms.nodeId && result.parent_id) {
      const url = new URL(location.href);
      url.searchParams.set("cmspid", result.parent_id);
      location.href = url;
      return;
    }
    cms.contents?.clear();
    document.querySelectorAll(`[qcms-id="${CSS.escape(String(id))}"]`).forEach(el => el.remove());
  }, el => cms.contPos(el).isDraggable());

  return contextMenu;
}
