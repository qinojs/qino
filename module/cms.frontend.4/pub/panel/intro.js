import { ctx, t } from "@qino/pub/qino.js";

const root = cms.panelRoot;
const find = selector => root.querySelector(selector);

function waitFor(selector, old) {
  const el = find(selector);
  if (el && el !== old) return el;
  return new Promise(resolve => {
    const observer = new MutationObserver(() => {
      const el = find(selector);
      if (!el || el === old) return;
      observer.disconnect();
      resolve(el);
    });
    observer.observe(root, { childList: true, subtree: true });
  });
}

const open = (name, selector, target = selector) => async () => {
  const old = cms.panel.sidebar.value === name ? null : find(selector);
  cms.panel.sidebar.set(name);
  const el = await waitFor(selector, old);
  await Promise.allSettled(el.closest(".-content")?.getAnimations().map(a => a.finished) ?? []);
  return find(target);
};

const page = selector => async () => {
  cms.panel.sidebar.set("");
  await Promise.allSettled(find("#panel").getAnimations({ subtree: true }).map(a => a.finished));
  return document.querySelector(selector);
};

const mark = (el, target = el) => async () => {
  await page(":root")();
  cms.contPos(el).mark();
  await new Promise(requestAnimationFrame);
  return typeof target === "string" ? document.querySelector(target) : target;
};

let tour;

export async function start() {
  const { Tour } = await import('@qino/u2/js/Tour/Tour.js');
  tour?.stop();
  const editable = document.querySelector("[cmstxt][contenteditable]");
  const module = document.querySelector('[qcms-mod]:not([qcms-mod^="layout."])[qcms-edit]');
  const steps = [
    {
      target: () => find("#panel > .-sidebar"),
      content: t`The sidebar contains the main CMS tools.`,
    },
    {
      target: open("tree", "#page-add"),
      content: t`Enter a title here to create a new subpage.`,
    },
    ...(find('[itemid="add"]').hidden ? [] : [{
      target: open("add", ".add-modules"),
      content: t`Add content modules to the current page here.`,
    }]),
    {
      target: open("settings", '[itemid="settings"] > .-content > *', '[itemid="settings"] > .-content'),
      content: t`Page settings, files and permissions are collected here.`,
    },
    ...(editable ? [{
      target: page("[cmstxt][contenteditable]"),
      content: t`Click directly into editable text to change it.`,
    }] : []),
    ...(module ? [{
      target: mark(module),
      content: t`Hover or click editable content to reveal its module controls.`,
    }, {
      target: mark(module, "#qgCmsContPosMenu"),
      content: t`Use the gear for module settings and the handle to move the module.`,
    }] : []),
  ];
  tour = new Tour(steps);
  const remember = () => ctx.settings["cms.frontend.4"].tour_seen.set(true);
  tour.addEventListener("complete", remember, { once: true });
  tour.addEventListener("close", remember, { once: true });

  await tour.start();
  tour.host.classList.add("qgCMS");

  return tour;
}
