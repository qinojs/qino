import { dataTransferToUrl } from "@qino/pub/util/transfer.mjs";

import { api, cms, t } from "./cms.js";

const block = event => {
  if (event.target.closest?.("[cmstxt][contenteditable]")) return;
  return event.composedPath().find(el => el instanceof Element && el.closest?.("[qcms-id][qcms-edit]"))?.closest("[qcms-id][qcms-edit]");
};

export function initFiles() {
  document.addEventListener("dragover", event => block(event) && event.preventDefault());
  document.addEventListener("drop", async event => {
    const el = block(event);
    if (!el) return;
    event.preventDefault();
    event.stopPropagation();
    const id = Number(el.getAttribute("qcms-id"));
    const files = [...event.dataTransfer.files].filter(file => !/[a-z0-9]{8}\.bmp$/i.test(file.name));
    if (files.length) await Promise.all(files.map(file => cms.cont(id).upload(file)));
    else {
      const url = dataTransferToUrl(event.dataTransfer);
      if (!url) return;
      const internal = url.includes(location.host) && url.match(/dbFile\/([0-9]+)\//)?.[1];
      await api.cms.node(id).files.post({ file: internal || url });
    }
    cms.contents.clear();
    await cms.reloadNode(id);
    cms.notice.show(t`File uploaded`);
  });
}
