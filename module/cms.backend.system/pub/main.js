cms.initCont("cms.backend.system", (el) => {
  const d = new Date();
  const off = -d.getTimezoneOffset() / 60;
  const tr = el.querySelector(".-browser-time")?.closest("tr");
  if (!tr) return;
  tr.querySelector(".-browser-time").textContent = d.toISOString().slice(0, 19).replace("T", " ");
  tr.querySelector(".-browser-tz").textContent = "UTC+" + off;
});
