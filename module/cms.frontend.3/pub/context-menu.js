import "@qino/pub/c1/fix/contextMenu.mjs";
import "@qino/pub/c1/contextMenu.mjs";

import { api, cms, t } from "./cms.js";

const SELECTOR = "[qcms-id][qcms-edit]";
const icon = name => new URL(`./img/${name}.svg`, import.meta.url).href;
const nodeId = el => Number(el.getAttribute("qcms-id"));

export const contextMenu = cms.contextMenu = cms.contextMenueContent = c1.globalContextMenu.addMenu(t`CMS Block`, {
  icon: new URL("./module.svg", import.meta.url).href,
  selector: SELECTOR,
  onshow(event) {
    const el = event.currentTarget;
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

export function initContextMenu({ dialogs, select }) {
  const add = (label, image, run) => contextMenu.addItem(label, {
    icon: icon(image),
    selector: SELECTOR,
    onshow(event) {
      this.activeId = nodeId(event.currentTarget);
    },
    async onclick() {
      try { await run(this.activeId); }
      catch (error) { await dialogs.alert(error?.message || String(error)); }
    },
  });

  add(t`Settings`, "settings", id => select(id));
  add(t`Copy`, "copy", async id => {
    await api.cms.node(id).copy.post();
    location.reload();
  });
  add(t`Cut`, "cut", async id => {
    await api.cms.clipboard.put({ value: id });
    document.querySelectorAll("[data-cms-cut]").forEach(el => el.removeAttribute("data-cms-cut"));
    document.querySelectorAll(`[qcms-id="${CSS.escape(String(id))}"]`).forEach(el => el.setAttribute("data-cms-cut", ""));
  });
  add(t`Delete`, "delete", async id => {
    if (!await dialogs.confirm(t`Really delete this content?`)) return;
    const result = await api.cms.node(id).delete();
    if (id === globalThis.qino.cms.nodeId && result.parent_id) {
      const url = new URL(location.href);
      url.searchParams.set("cmspid", result.parent_id);
      location.href = url;
      return;
    }
    document.querySelectorAll(`[qcms-id="${CSS.escape(String(id))}"]`).forEach(el => el.remove());
  });

  return contextMenu;
}
