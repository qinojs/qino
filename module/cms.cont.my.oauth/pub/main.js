import { api, hee, t } from "@qino/pub/qino.js";

const oauth = api["auth.oauth"];
const fmt = (ts) => ts ? new Date(ts * 1000).toLocaleDateString() : "";

cms.initNode("cont.my.oauth", async (el) => {
  const list = el.querySelector("[data-links]");
  const msg = el.querySelector(".-msg");
  const labels = {
    connected: await t`Connected`,
    lastUsed: await t`Last used`,
    never: await t`Never used`,
    del: await t`Disconnect`,
    delConfirm: await t`Disconnect this account? You can connect it again at any time.`,
    empty: await t`No provider connected yet.`,
    error: await t`Error loading.`,
  };

  // The round trip leaves the page, so the proof is asked for here — `oauth/start` is a route and
  // could only answer a demand with an error page.
  el.addEventListener("click", async (event) => {
    const link = event.target.closest("[data-connect]");
    if (!link) return;
    event.preventDefault();
    show();
    try {
      await oauth.connect.post();
      location.href = link.href;
    } catch (e) { show(e?.message || String(e)); }
  });

  const show = (value = "") => void (msg.value = value);

  const load = async () => {
    try {
      const rows = await oauth.get();
      list.innerHTML = rows.length
        ? rows.map((row) => `<div data-provider="${hee(row.provider)}" data-sub="${hee(row.sub)}">
            <p><strong>${hee(row.provider)}</strong>
              <small>${hee(labels.connected)} ${hee(fmt(row.created))} ·
                ${row.lastUsed ? `${hee(labels.lastUsed)} ${hee(fmt(row.lastUsed))}` : hee(labels.never)}</small></p>
            <button type=button data-delete>${hee(labels.del)}</button>
          </div>`).join("")
        : hee(labels.empty);
    } catch (e) {
      list.textContent = labels.error;
      show(e?.message || String(e));
    }
  };

  list.addEventListener("click", async (event) => {
    const row = event.target.closest("[data-provider]");
    if (!row || !event.target.closest("[data-delete]")) return;
    if (!confirm(labels.delConfirm)) return;
    show();
    try {
      await oauth(row.dataset.provider)(row.dataset.sub).delete();
      await load();
    } catch (e) { show(e?.message || String(e)); }
  });

  load();
});
