import { api, hee, t } from "@qino/pub/qino.js";

const telegram = api["messaging.telegram"];
const fmt = (ts) => ts ? new Date(ts * 1000).toLocaleDateString() : "";

cms.initNode("cont.my.telegram", async (el) => {
  const state = el.querySelector("[data-state]");
  const msg = el.querySelector(".-msg");

  const labels = {
    connect: await t`Connect Telegram`,
    hint: await t`Press “Start” in Telegram — this page notices it by itself.`,
    connected: await t`Connected since`,
    disconnect: await t`Disconnect`,
    confirm: await t`Disconnect Telegram?`,
    error: await t`Error loading.`,
  };

  const draw = (url, chats) => {
    state.innerHTML = chats.length
      ? chats.map((c) => `<p>${hee(labels.connected)} ${hee(fmt(c.created))}${c.username ? ` · @${hee(c.username)}` : ""}
          <button type=button data-disconnect>${hee(labels.disconnect)}</button></p>`).join("")
      : `<p><a href="${hee(url)}" target=_blank rel=noopener data-connect>${hee(labels.connect)}</a>
          <small>${hee(labels.hint)}</small></p>`;
  };

  /** Redraw from the server — also renews the deep link, since every answer carries a fresh one. */
  const refresh = async () => {
    try {
      const { url, chats } = await telegram.link.get();
      draw(url, chats);
      return chats.length;
    } catch (e) {
      state.textContent = labels.error;
      msg.value = e?.message || String(e);
      return 0;
    }
  };

  // Telegram cannot tell the page that Start was pressed, so watch for it while the user is in the flow
  let until = 0;
  setInterval(async () => {
    if (Date.now() > until || document.hidden) return;
    if (await refresh()) until = 0;
  }, 5000);

  el.addEventListener("click", async (e) => {
    if (e.target.closest("[data-connect]")) return void (until = Date.now() + 5 * 60_000);
    if (!e.target.closest("[data-disconnect]")) return;
    if (!confirm(labels.confirm)) return;
    await telegram.link.delete();
    await refresh();
  });

  refresh();
});
