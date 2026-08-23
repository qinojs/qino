const data = globalThis.qino?.cms;
if (data) {
  const toggle = () => {
    const url = new URL(location.href);
    url.searchParams.set("cms_editmode", data.editmode ? "0" : "1");
    url.searchParams.set("cmspid", data.requestedNodeId ?? data.nodeId);
    location.href = url;
  };
  const button = document.createElement("button");
  button.className = "qino-cms-toggle";
  button.type = "button";
  button.textContent = data.editmode ? "Exit CMS" : "CMS";
  button.addEventListener("click", toggle);
  document.addEventListener("keydown", event => {
    const target = event.composedPath()[0];
    if (event.key === "e" && !event.ctrlKey && !event.altKey && !event.metaKey && !event.shiftKey &&
      target.getRootNode() === document && !target.isContentEditable && target.form === undefined) toggle();
  });
  document.body.append(button);
  if (data.editmode) {
    button.hidden = true;
    await import("./panel.js");
  }
}
