import { api } from "@qino/pub/api.js";
import { t } from "@qino/pub/t.js";

// Let an agent sleep now, carry out a night's plan; the tables follow along every few seconds.
cms.initNode("backend.ai.agents.sleep", (el) => {
  const nid = Number(cms.el.nid(el));
  const post = (data) => api.cms.node(nid).api.post(data).catch((err) => ({ message: err.message }));
  const alert = async (message) => (await import("@qino/u2/js/dialog/dialog.js")).alert(message);
  const night = new URL(location.href).searchParams.get("night");
  const vars = night ? { night } : {};
  const refresh = () => Promise.all([...el.querySelectorAll("[cms-part]")].map((part) => cms.reloadPart(nid, part.getAttribute("cms-part"), vars)));

  el.addEventListener("click", async (e) => {
    const button = e.target.closest("[data-sleep], [data-apply]");
    if (!button) return;
    button.disabled = true;
    const res = await post(button.dataset.sleep ? { sleep: Number(button.dataset.sleep) } : { apply: Number(button.dataset.apply) });
    if (!res?.ok) await alert(res?.message ?? "Error");
    else if (button.dataset.sleep) await alert(await (res.asleep ? t`Asleep: the plan for its memories comes once the models answered.` : t`Nothing new since it last slept.`));
    await refresh();
  });

  const timer = setInterval(() => el.isConnected ? refresh() : clearInterval(timer), 10000);
});
