import { apt } from "../../core/pub/js/qino.js";

cms.initNode("backend.security", (el) => {
  const nid = Number(cms.el.nid(el));

  const post = (vars) => apt.cms.node(nid).html.post({ vars }).then((html) => {
    el.outerHTML = html;
  });

  el.querySelector("[data-settings]")?.addEventListener("submit", (e) => {
    e.preventDefault();
    post({ save: Object.fromEntries(new FormData(e.target)) });
  });
  el.querySelector("[data-text]")?.addEventListener("submit", (e) => {
    e.preventDefault();
    post({ text: Object.fromEntries(new FormData(e.target)) });
  });
  el.addEventListener("click", (e) => {
    const action = e.target.closest("[data-action]");
    if (action) post({ [action.dataset.action]: 1 });
    const release = e.target.closest("[data-release]");
    if (release) post({ release: release.dataset.release });
    const block = e.target.closest("[data-block]");
    if (block) post({ block: block.dataset.block });
    const seen = e.target.closest("[data-seen]");
    if (seen) post({ seen: seen.dataset.seen });
    const ignore = e.target.closest("[data-ignore]");
    if (ignore) post({ ignore: ignore.dataset.ignore });
  });
});
