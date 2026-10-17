// Reports the rendered box of both variants so the two columns can be compared numerically.
import { SelectorObserver } from '@qino/u2/js/SelectorObserver/SelectorObserver.js';

new SelectorObserver({ on: init }).observe('[qcms-mod="cont.image2.test"]');

function init(root) {
  root.addEventListener("click", (e) => {
    const btn = e.target.closest(".-nocssBtn");
    if (!btn) return;
    const section = btn.closest("section");
    section.classList.toggle("-nocss");
    btn.textContent = section.classList.contains("-nocss") ? "CSS on" : "CSS off";
    for (const el of section.querySelectorAll(".-img")) measure(el);
  });

  const observer = new ResizeObserver((entries) => {
    for (const entry of entries) measure(entry.target);
  });
  for (const el of root.querySelectorAll(".-img")) {
    observer.observe(el);
    measure(el);
  }
  root.addEventListener("load", (e) => measure(e.target.closest(".-img") ?? e.target), true);
}

function measure(el) {
  const info = el.closest(".-cell")?.querySelector(".-info");
  if (!info) return;
  const rect = el.getBoundingClientRect();
  const img = el.tagName === "IMG" ? el : el.querySelector("img");
  const lines = [`box ${round(rect.width)} x ${round(rect.height)}`];
  if (img) {
    lines.push(`natural ${img.naturalWidth} x ${img.naturalHeight}`);
    lines.push(src(img.currentSrc || img.src));
  } else {
    lines.push("no <img> yet");
  }
  info.textContent = lines.join("\n");
}

const round = (v) => Math.round(v * 10) / 10;
const src = (url) => url.startsWith("data:") ? "src data: (" + url.length + " bytes)" : "src " + url.split("/").slice(-3).join("/");
