import { api } from "@qino/pub/api.js";
import { html } from "@qino/pub/html.js";
import { t as translate } from "@qino/pub/t.js";
import { SelectorObserver } from "@qino/u2/js/SelectorObserver/SelectorObserver.js";

const t = translate.in("cms.backend");
const local = (seconds) => {
  const date = new Date(seconds * 1000);
  return new Date((seconds - date.getTimezoneOffset() * 60) * 1000).toISOString().slice(0, 19);
};

new SelectorObserver({ on: async (el) => {
  const ref = api.cms.node(Number(el.dataset.nodeAccess)), prefix = crypto.getRandomValues(new Uint32Array(2)).join("-");
  let vs, access = JSON.parse(el.dataset.access), queue = Promise.resolve(), version = 0;
  const setStatus = async (message) => {
    const output = el.querySelector("[data-access-status]");
    output.textContent = await message;
    output.hidden = !output.textContent;
  };
  const summary = async () => {
    const now = Date.now() / 1000;
    el.querySelector("[data-access-summary]").textContent = await (vs.online ? t`Published`
      : vs.onlineStart > now ? t`Scheduled` : vs.onlineEnd > 0 && vs.onlineEnd <= now ? t`Publication ended` : t`Not published`);
  };
  try {
    vs = await ref.get();
    if (!el.isConnected) return;
    const write = el.dataset.write === "true" && vs.myaccess >= 2, admin = write && vs.myaccess >= 3;
    const controls = (field, label) => html.async`<u2-buttongroup style="flex-wrap:wrap" role=group aria-label="${label}">
      <button type=button data-mode=unlimited aria-pressed="${vs[field] === 0}" ${!write || vs[field] === 0 ? html`disabled` : ""}>${t`Unlimited`}</button>
      <button type=button data-mode=inherit aria-pressed="${vs[field] === null}" ${!write || vs[field] === null ? html`disabled` : ""}>${t`Inherit`}</button>
      <button type=button data-mode=date ${vs[field] ? html`hidden` : ""} ${!write ? html`disabled` : ""}>${t`Date`}</button>
      <input id="${prefix}-${field}" type=datetime-local step=1 data-date="${field}" value="${vs[field] ? local(vs[field]) : ""}" aria-label="${label}" required ${!vs[field] ? html`hidden` : ""} ${!write ? html`disabled` : ""}>
    </u2-buttongroup>`;
    el.innerHTML = await html.async`
      <div class="-head u2-flex -Between"><span>${t`Sharing`}</span><span data-access-summary></span></div>
      ${admin ? html.async`<div>
        <label><input type=checkbox data-inherit ${access === null ? html`checked` : ""}> ${t`Inherit group permissions`}</label>
        <div data-inherited hidden></div>
        <div data-own ${access === null ? html`hidden` : ""}><label><input type=checkbox data-public ${vs.public ? html`checked` : ""}> ${t`Public read access`}</label></div>
      </div>
      <div data-group-search hidden><search><input type=search data-search aria-label="${t`Search groups`}" placeholder="${t`Search groups`}"></search></div>
      <div data-grants tabindex=0 style="padding:0;overflow:auto;max-block-size:24rem" ${access === null ? html`hidden` : ""}></div>`
        : html.async`<p>${access === null ? t`Inherited` : vs.public ? t`Public access` : t`Restricted access`}</p>`}
      <div><details data-schedule ${vs.onlineStart || vs.onlineEnd ? html`open` : ""}>
        <summary>${t`Publication period`}</summary>
        <table class="u2-table -NoSideGaps" style="padding:0"><tbody>
          ${[["onlineStart", t`Visible from`], ["onlineEnd", t`Visible until`]].map(([field, label]) => html.async`<tr>
            <th scope=row><label for="${prefix}-${field}">${label}</label></th>
            <td data-edge="${field}">${controls(field, label)}</td>
          </tr>`)}
        </tbody></table>
      </details></div>
      <output data-access-status role=status hidden></output>`;
    await summary();
    el.ariaBusy = "false";

    const levels = [t`No additional permission`, t`Read`, t`Edit`, t`Administer`];
    const loadGroups = async (search = "") => {
      const current = ++version, data = await ref.access.groups.get({ search });
      if (!el.isConnected || current !== version) return;
      const inherited = !!data.inheritsFrom;
      el.querySelector("[data-inherit]").checked = inherited;
      el.querySelector("[data-own]").hidden = inherited;
      el.querySelector("[data-public]").checked = !!vs.public;
      el.querySelector("[data-inherited]").hidden = !inherited;
      el.querySelector("[data-inherited]").textContent = inherited ? `${await t`Inherited from`}: ${data.inheritsFrom.title}` : "";
      el.querySelector("[data-group-search]").hidden = inherited || data.total <= data.rows.length && !search;
      const grants = el.querySelector("[data-grants]");
      grants.hidden = inherited;
      if (inherited) return;
      const rows = await html.async`<table class="u2-table" style="padding:0">
        <thead><tr>
          <th scope=col>${t`Group`}</th>
          ${levels.map((label, level) => html.async`<th scope=col style="text-align:center" title="${label}">${level ? label : "—"}</th>`)}
        </tr></thead><tbody>
          ${data.rows.length ? data.rows.map((row) => html.async`<tr>
            <th scope=row>${row.label || "#" + row.id}</th>
            ${levels.map((label, level) => html.async`<td style="text-align:center"><input type=radio name="${prefix}-group-${row.id}" data-grant="${row.id}" value="${level}" ${Number(row.access || 0) === level ? html`checked` : ""} aria-label="${row.label || "#" + row.id}: ${label}"></td>`)}
          </tr>`) : html.async`<tr><td colspan=5>${t`No entries found.`}</td></tr>`}
        </tbody></table>`;
      if (current === version) grants.innerHTML = rows;
    };
    let searchTimer;
    el.addEventListener("input", (event) => {
      if (!event.target.matches("[data-search]") || event.isComposing) return;
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => loadGroups(event.target.value).catch((error) => setStatus(error.message)), 300);
    });
    const execute = (run) => {
      queue = queue.then(async () => {
        try { await setStatus(t`Saving…`); await run(); await summary(); await setStatus(t`Saved`); }
        catch (error) { await setStatus(error?.message || String(error)); }
      });
    };
    el.addEventListener("click", (event) => {
      const button = event.target.closest("[data-mode]");
      if (!button || button.disabled) return;
      const edge = button.closest("[data-edge]"), field = edge.dataset.edge;
      if (button.dataset.mode === "date") {
        button.hidden = true;
        for (const item of edge.querySelectorAll("button")) item.disabled = !write;
        const date = edge.querySelector("[data-date]");
        date.hidden = false;
        date.focus();
        setStatus(t`Choose a date and time.`);
        return;
      }
      const value = button.dataset.mode === "inherit" ? "" : "0";
      execute(async () => {
        vs = await ref.patch({ [field]: value });
        edge.innerHTML = await controls(field, field === "onlineStart" ? t`Visible from` : t`Visible until`);
      });
    });
    el.addEventListener("change", (event) => {
      const input = event.target;
      if (input.matches("[data-inherit], [data-public]")) {
        const value = input.matches("[data-inherit]") ? input.checked ? null : 0 : input.checked ? 1 : 0;
        version++;
        execute(async () => {
          await ref.access.put(value === null ? {} : { value });
          access = value;
          vs = await ref.get();
          await loadGroups(el.querySelector("[data-search]").value);
        });
      } else if (input.matches("[data-date]")) {
        if (!input.checkValidity()) return;
        const field = input.dataset.date, value = String(Math.floor(new Date(input.value).getTime() / 1000));
        execute(async () => { vs = await ref.patch({ [field]: value }); });
      } else if (input.matches("[data-grant]")) {
        const id = Number(input.dataset.grant), access = Number(input.value);
        version++;
        execute(() => ref.access.groups(id).put({ access }));
      }
    });
    if (admin) loadGroups().catch((error) => setStatus(error.message));
  } catch (error) {
    el.ariaBusy = "false";
    const output = el.querySelector("[role=status]");
    output.hidden = false;
    output.textContent = error?.message || String(error);
  }
}}).observe("[data-node-access]");
