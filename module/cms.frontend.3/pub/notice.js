import { api, cms, h, t } from "./cms.js";

export function initNotice(root) {
  const message = h("div", { class: "-msg" });
  const el = h("div", { id: "cmsConsole", popover: "manual", role: "status", "aria-live": "polite" }, message);
  let timeout;

  const show = async (text, type = "info") => {
    message.textContent = await text;
    el.dataset.type = type;
    if (!el.matches(":popover-open")) el.showPopover();
    el.classList.add("-active", "-new");
    clearTimeout(timeout);
    requestAnimationFrame(() => el.classList.remove("-new"));
    timeout = setTimeout(() => el.classList.remove("-active"), 2200);
  };

  root.append(el);
  cms.console = cms.notice = { show };
  api.addEventListener("error", ({ detail }) => show(detail.error?.message || t`API call failed`, "error"));
  return cms.notice;
}
