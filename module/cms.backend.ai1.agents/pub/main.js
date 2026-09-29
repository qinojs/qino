// What is going on: the newest messages, refreshed every few seconds while the page is open.
cms.initNode("backend.ai1.agents", (el) => {
  const nid = Number(cms.el.nid(el));
  const timer = setInterval(() => el.isConnected ? cms.reloadPart(nid, "recent") : clearInterval(timer), 5000);
});
