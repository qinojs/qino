import { api } from "@qino/pub/api.js";
import { t as translate } from "@qino/pub/t.js";
import { SelectorObserver } from "@qino/u2/js/SelectorObserver/SelectorObserver.js";

import { colors } from "./sources.js";

const t = translate.in("cms.backend.calendar");

new SelectorObserver({ on: async (el) => {
  const status = el.querySelector("[role=status]"), list = el.querySelector("ol");
  const sources = JSON.parse(el.dataset.sources), sourceColors = colors(sources);
  const now = new Date(), until = new Date(now);
  until.setDate(until.getDate() + 7);
  try {
    // The server applies the user's saved source selection; no all-sources override is sent.
    const items = await api.cms.node(Number(el.dataset.calendarDashboard)).api.post({
      start: now.toISOString(), end: until.toISOString(), timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    });
    if (!el.isConnected) return;
    const date = (value) => {
      if (/[Tt ]/.test(value)) return new Date(value);
      const [year, month, day] = value.split("-").map(Number);
      return new Date(year, month - 1, day);
    };
    const format = (value) => new Intl.DateTimeFormat(document.documentElement.lang || undefined, {
      dateStyle: "medium", ...(/[Tt ]/.test(value) && { timeStyle: "short" }),
    }).format(date(value));
    const sorted = items.sort((a, b) => date(a.start) - date(b.start)).slice(0, 10);
    list.replaceChildren();
    for (const item of sorted) {
      const row = document.createElement("li"), title = document.createElement("span");
      title.textContent = item.title;
      const color = sourceColors.get(item.source);
      const template = [...el.querySelectorAll("template[data-source-icon]")].find((template) => template.dataset.sourceIcon === item.source);
      if (template) {
        const icon = template.content.cloneNode(true);
        if (color) icon.querySelector("svg").style.color = color;
        title.prepend(icon, document.createTextNode(" "));
      }
      const url = item.editUrl || item.url;
      if (url && ["http:", "https:"].includes(new URL(url, location.href).protocol)) {
        const link = document.createElement("a");
        link.href = url;
        link.append(title);
        row.append(link);
      } else row.append(title);
      const time = document.createElement("time");
      time.dateTime = item.start;
      if (/[Tt ]/.test(item.start)) time.textContent = `${format(item.start)} – ${format(item.end)}`;
      else {
        const last = date(item.end);
        last.setDate(last.getDate() - 1);
        const end = new Intl.DateTimeFormat(document.documentElement.lang || undefined, { dateStyle: "medium" }).format(last);
        time.textContent = format(item.start) === end ? end : `${format(item.start)} – ${end}`;
      }
      row.append(document.createElement("br"), time);
      list.append(row);
    }
    status.textContent = sorted.length ? await t`Current and upcoming appointments (next 7 days)` : await t`No entries in this period.`;
  } catch (error) {
    if (el.isConnected) status.textContent = error?.message || String(error);
  }
} }).observe("[data-calendar-dashboard]");
