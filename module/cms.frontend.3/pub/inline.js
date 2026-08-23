import { cms } from "./cms.js";
import { initContextMenu } from "./context-menu.js";
import { initContents } from "./contents.js";
import { initFiles } from "./files.js";
import { initNotice } from "./notice.js";
import { addStyle, shell } from "./shell.js";
import { initText } from "./text.js";

const current = globalThis.qino?.cms?.nodeId;
if (current && globalThis.qino.cms.editmode) {
  const { root } = shell();
  addStyle(root, new URL("./inline.css", import.meta.url));
  initNotice(root);
  await initText(root);
  await initContents(root);
  initFiles();
  initContextMenu();
  const clipboard = globalThis.qino.cms.clipboard;
  if (clipboard) {
    const paste = () => cms.contents.clipboard(clipboard);
    cms.panelRoot ? paste() : document.addEventListener("cms:panel-ready", paste, { once: true });
  }
  cms.inline = { contents: cms.contents, contextMenu: cms.contextMenu, notice: cms.notice };
}
