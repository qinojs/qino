import "@qino/u2/el/calendar/calendar.js";
import { api } from "@qino/pub/api.js";
import { t as translate } from "@qino/pub/t.js";

import { colors } from "./sources.js";

const t = translate.in("cms.backend.calendar");

cms.initNode("backend.calendar", (el) => {
  const calendar = el.querySelector("u2-calendar"), status = el.querySelector("[role=status]");
  const node = api.cms.node(Number(cms.el.nid(el)));
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const sources = JSON.parse(el.dataset.sources);
  const sourceColors = colors(sources);
  const icons = new Map([...el.querySelectorAll("template[data-source-icon]")].map((template) => [template.dataset.sourceIcon, template]));
  let selected = JSON.parse(el.dataset.selected);
  let version = 0, period = "";

  const load = async ({ start, end }, save = false) => {
    if (!el.isConnected) return;
    const key = JSON.stringify([start, end, selected]);
    if (!start || key === period) return;
    period = key;
    const current = ++version;
    calendar.replaceChildren();
    calendar.setAttribute("aria-busy", "true");
    status.textContent = "";
    try {
      const items = await node.api.post({ start, end, timeZone, sources: selected, ...(save && { save: true }) });
      if (current !== version || !el.isConnected) return;
      for (const item of items) {
        const entry = document.createElement("u2-calendar-item");
        entry.setAttribute("start", item.start);
        entry.setAttribute("end", item.end);
        entry.dataset.source = item.source;
        entry.dataset.id = item.id;
        const color = sourceColors.get(item.source);
        if (color) entry.style.setProperty("--color", color);
        const url = item.editUrl || item.url;
        if (url && ["http:", "https:"].includes(new URL(url, location.href).protocol)) {
          const link = document.createElement("a");
          link.href = url;
          link.textContent = item.title;
          entry.append(link);
        } else entry.textContent = item.title;
        const icon = icons.get(item.source)?.content.cloneNode(true);
        if (icon) (entry.querySelector("a") ?? entry).prepend(icon, document.createTextNode(" "));
        calendar.append(entry);
      }
      const message = items.length ? "" : await t`No entries in this period.`;
      if (current === version) status.textContent = message;
    } catch (error) {
      if (current === version && el.isConnected) {
        period = "";
        status.textContent = error?.message || String(error);
      }
    } finally {
      if (current === version) calendar.removeAttribute("aria-busy");
    }
  };

  el.querySelector("[data-calendar-sources]").addEventListener("click", async () => {
    const { form } = await import("@qino/u2/js/dialog/dialog.js");
    const fields = document.createElement("fieldset");
    const legend = document.createElement("legend");
    legend.textContent = await t`Sources`;
    fields.append(legend);
    for (const source of sources) {
      const label = document.createElement("label"), input = document.createElement("input");
      const color = sourceColors.get(source.id);
      if (color) label.style.color = color;
      input.type = "checkbox";
      input.name = source.id;
      input.value = "1";
      input.toggleAttribute("checked", selected.includes(source.id));
      label.append(input, document.createTextNode(" "));
      const icon = icons.get(source.id)?.content.cloneNode(true);
      if (icon) label.append(icon, document.createTextNode(" "));
      label.append(document.createTextNode(source.title));
      fields.append(label, document.createElement("br"));
    }
    const values = await form(fields.outerHTML, {
      root: el,
      lang: document.documentElement.lang,
      init: (dialog) => {
        dialog.setAttribute("aria-label", legend.textContent);
        dialog.classList.add("cms-calendar-sources");
      },
    });
    if (!values) return;
    selected = Object.keys(values);
    period = "";
    await load(calendar.range, true);
  });

  calendar.addEventListener("rangechange", (event) => load(event.detail));
  const now = new Date();
  calendar.setAttribute("date", `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`);
  if (calendar.range) load(calendar.range);
});
