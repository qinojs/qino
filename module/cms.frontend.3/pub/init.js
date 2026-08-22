const data = globalThis.qino?.cms;
if (data) {
  const button = document.createElement("button");
  button.className = "qino-cms-toggle";
  button.type = "button";
  button.textContent = data.editmode ? "Exit CMS" : "CMS";
  button.addEventListener("click", () => {
    const url = new URL(location.href);
    url.searchParams.set("cms_editmode", data.editmode ? "0" : "1");
    url.searchParams.set("cmspid", data.requestedNodeId ?? data.nodeId);
    location.href = url;
  });
  document.body.append(button);
  if (data.editmode) {
    button.hidden = true;
    await import("./panel.js");
  }
}
