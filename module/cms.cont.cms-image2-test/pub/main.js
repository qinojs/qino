function init(root) {
  initCases(root);
  initLab(root);
  setTimeout(() => start(root), Math.max(0, Number(root.dataset.delay) || 0));
}

function initCases(root) {
  for (const el of root.querySelectorAll("[data-c2t-case]")) {
    if (el.__c2tCaseInit) continue;
    const c = {
      el,
      img: el.querySelector("cms-image2"),
      out: el.querySelector(".c2t-metric"),
      params: el.querySelector(".c2t-params"),
      before: null,
    };
    if (!c.img || !c.out || !c.params) continue;
    el.__c2tCaseInit = true;

    const update = () => updateCase(c);
    const ro = new ResizeObserver(update);
    const mo = new MutationObserver(update);
    el.__c2tClean = () => { ro.disconnect(); mo.disconnect(); };
    ro.observe(c.img);
    mo.observe(c.img, { attributes:true, childList:true, attributeFilter:["loaded", "style"] });

    requestAnimationFrame(() => {
      c.before = rect(c.img);
      updateCase(c);
    });
  }
}

function initLab(root) {
  const form = root.querySelector(".c2t-lab-form");
  if (!form || form.__c2tLabInit) return;
  form.__c2tLabInit = true;
  form.addEventListener("submit", (e) => e.preventDefault());

  const update = () => {
    updateControls(form);
    const card = form.closest("[data-c2t-case]");
    card?.setAttribute("data-c2t-params", paramsText(formParams(form)));
    card?.querySelector(".c2t-params")?.replaceChildren(card.dataset.c2tParams);
  };
  const reload = debounce(() => reloadLab(root, formParams(form), form.querySelector("[data-c2t-reload]")), 500);

  for (const input of form.querySelectorAll("[data-c2t-param], [data-c2t-auto]")) {
    input.addEventListener("input", () => { update(); reload(); });
    input.addEventListener("change", () => { update(); reload(); });
  }
  form.querySelector("[data-c2t-reload]")?.addEventListener("click", (e) => reloadLab(root, formParams(form), e.currentTarget));
  update();
}

function start(root) {
  if (!globalThis.cms_image2) {
    setTimeout(() => start(root), 50);
    return;
  }
  for (const img of root.querySelectorAll("cms-image2[wait]")) {
    img.removeAttribute("wait");
    globalThis.cms_image2.init(img);
  }
}

function reloadLab(root, lab, btn = null) {
  const nid = globalThis.cms?.el?.nid(root) || root.closest("[qcms-id]")?.getAttribute("qcms-id");
  if (!nid || !globalThis.cms?.reloadPart) return;
  if (root.__c2tReloading) return root.__c2tReloadQueued = lab;
  root.__c2tReloading = true;
  if (btn) btn.disabled = true;
  root.querySelector(".c2t-lab")?.__c2tClean?.();
  globalThis.cms.reloadPart(nid, "lab", { lab }).then(() => {
    init(root);
  }).finally(() => {
    root.__c2tReloading = false;
    const newBtn = root.querySelector("[data-c2t-reload]");
    if (newBtn) newBtn.disabled = false;
    const queued = root.__c2tReloadQueued;
    root.__c2tReloadQueued = null;
    if (queued) reloadLab(root, queued);
  });
}

function updateCase(c) {
  const now = rect(c.img);
  const loaded = c.img.hasAttribute("loaded");
  const target = Number(getComputedStyle(c.img).getPropertyValue("--aspect-ratio")) || 0;
  const ratio = now.w ? now.h / now.w : 0;
  const ratioDiff = target && ratio ? Math.abs(ratio - target) / target : 0;
  const shift = c.before ? Math.max(Math.abs(now.w - c.before.w), Math.abs(now.h - c.before.h)) : 0;
  const tiny = now.w <= 12 || now.h <= 12;
  const bad = tiny || ratioDiff > .04;
  const warn = !bad && (ratioDiff > .015 || (loaded && shift > 2));

  c.el.classList.toggle("is-ok", !bad && !warn);
  c.el.classList.toggle("is-warn", warn);
  c.el.classList.toggle("is-bad", bad);
  c.el.classList.toggle("is-loaded", loaded);

  const parts = [
    `${fmt(now.w)}x${fmt(now.h)}`,
    target ? `ratio ${ratio.toFixed(3)}/${target.toFixed(3)}` : "ratio n/a",
    loaded ? "loaded" : "preview",
  ];
  if (tiny) parts.push("tiny");
  if (ratioDiff > .015) parts.push(`ratio-diff ${Math.round(ratioDiff * 1000) / 10}%`);
  if (loaded) parts.push(`shift ${fmt(shift)}px`);
  c.out.value = parts.join(" | ");
  c.out.textContent = c.out.value;
  c.params.textContent = c.el.dataset.c2tParams || c.params.textContent;
}

function formParams(form) {
  const p = {};
  for (const input of form.querySelectorAll("[data-c2t-param]")) p[input.dataset.c2tParam] = input.value;
  for (const input of form.querySelectorAll("[data-c2t-auto]")) p[input.dataset.c2tAuto === "width" ? "autoW" : "autoH"] = input.checked;
  return {
    width:Number(p.width) || 1,
    height:Number(p.height) || 1,
    autoW:!!p.autoW,
    autoH:!!p.autoH,
    fit:p.fit === "contain" ? "contain" : "cover",
    hpos:Number(p.hpos) || 0,
    vpos:Number(p.vpos) || 0,
    box:Number(p.box) || 1,
  };
}

function updateControls(form) {
  for (const input of form.querySelectorAll("[data-c2t-param]")) {
    const out = input.closest("label")?.querySelector("output");
    if (out) out.value = out.textContent = input.value + (input.tagName === "SELECT" ? "" : input.dataset.unit || "");
  }
  for (const input of form.querySelectorAll("[data-c2t-auto]")) {
    const name = input.dataset.c2tAuto;
    const slider = form.querySelector(`[data-c2t-param="${name}"]`);
    const out = input.closest("label")?.querySelector("output");
    if (slider) slider.disabled = input.checked;
    if (out) out.value = out.textContent = input.checked ? "auto" : "";
  }
}

function rect(el) {
  const r = el.getBoundingClientRect();
  return { w:r.width, h:r.height };
}

function fmt(v) {
  return String(Math.round(v * 10) / 10);
}

function paramsText(p) {
  return `${p.autoW ? "width:auto" : `width=${p.width}`}, ${p.autoH ? "height:auto" : `height=${p.height}`}, fit=${p.fit}, hpos=${p.hpos}, vpos=${p.vpos}, box=${p.box}px`;
}

function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

if (globalThis.cms?.initNode) cms.initNode("cont.cms-image2-test", init);
else {
  document.addEventListener("DOMContentLoaded", () => document.querySelectorAll(".cms-image2-test").forEach(init));
  document.querySelectorAll(".cms-image2-test").forEach(init);
}
