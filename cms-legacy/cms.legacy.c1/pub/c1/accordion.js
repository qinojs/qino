// The PHP CMS's c1 accordion (`.c1-accordion`), without the c1 library: a trigger (`.-trigger`)
// toggles its panel — the element `aria-controls` names, else the next sibling. The panel's height is
// animated by the site css (transition on height), so it is set explicitly while it moves.
const TRIGGER = ".c1-accordion > .-trigger";
let ids = 0;

function panelOf(trigger) {
  const named = document.getElementById(trigger.getAttribute("aria-controls"));
  if (named) return named;
  const panel = trigger.nextElementSibling;
  panel.id ||= "c1-accordion-" + ++ids;
  trigger.setAttribute("aria-controls", panel.id);
  panel.classList.add("-panel");
  panel.setAttribute("role", "region");
  return panel;
}

const contentHeight = (panel) => (panel.querySelector(":scope > .-content") ?? panel).offsetHeight + "px";

function toggle(trigger, open) {
  const panel = panelOf(trigger);
  panel.style.overflow = "hidden";
  panel.addEventListener("transitionend", () => panel.style.height = panel.style.overflow = "", { once: true });
  if (open) {
    panel.hidden = false;
    const height = contentHeight(panel);
    panel.style.height = "0";
    setTimeout(() => panel.style.height = height, 10);
  } else {
    panel.style.height = contentHeight(panel);
    setTimeout(() => { panel.style.height = ""; panel.hidden = true; }, 10);
  }
  trigger.setAttribute("aria-expanded", String(open));
  if (trigger.id) history.replaceState(null, "", location.pathname + location.search + (open ? "#" + trigger.id : ""));
}

function activate(trigger) {
  const accordion = trigger.parentNode;
  const open = trigger.getAttribute("aria-expanded") !== "true";
  if (open && accordion.hasAttribute("data-singlemode")) {
    for (const other of accordion.querySelectorAll(":scope > .-trigger[aria-expanded=true]")) toggle(other, false);
    const ms = parseFloat(getComputedStyle(panelOf(trigger)).transitionDuration) * 1000 || 0;
    setTimeout(() => trigger.scrollIntoView({ behavior: "smooth" }), ms);
  }
  toggle(trigger, open);
}

document.addEventListener("click", (e) => {
  const trigger = e.target.closest(TRIGGER);
  if (!trigger || e.target.closest("[contenteditable]")) return;
  e.preventDefault();
  activate(trigger);
});

document.addEventListener("keydown", (e) => {
  const trigger = e.target.closest?.(TRIGGER);
  if (!trigger || e.target !== trigger) return;
  const triggers = [...trigger.parentNode.querySelectorAll(":scope > .-trigger")];
  const i = triggers.indexOf(trigger);
  const to = { ArrowDown: i + 1, ArrowUp: i - 1, Home: 0, End: triggers.length - 1 }[e.key];
  if (to !== undefined) triggers[to]?.focus();
  else if (e.key === "Enter" || e.key === " ") activate(trigger);
  else return;
  e.preventDefault();
});

// no text selection on double click
document.addEventListener("mousedown", (e) => e.detail > 1 && e.target.closest(TRIGGER) && e.preventDefault());

// a linked item opens on load
const linked = location.hash ? document.getElementById(decodeURIComponent(location.hash.slice(1))) : null;
if (linked?.matches(TRIGGER)) {
  linked.setAttribute("aria-expanded", "true");
  panelOf(linked).hidden = false;
}
