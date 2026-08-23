const ghost = document.createElement("div");
ghost.dataset.cmsPlaceholder = "";

const distance = (el, x, y) => {
  const box = el.getBoundingClientRect();
  const dx = Math.min(Math.abs(box.left - x), Math.abs(box.right - x));
  const dy = Math.min(Math.abs(box.top - y), Math.abs(box.bottom - y));
  const inside = y >= box.top && y <= box.bottom && x >= box.left && x <= box.right;
  return (inside ? Math.min(dx, dy) / 50 : y >= box.top && y <= box.bottom ? dx : x >= box.left && x <= box.right ? dy : Math.hypot(dx, dy));
};

const nearest = (event, targets, moving) => [...targets]
  .filter(el => !moving.contains(el))
  .sort((a, b) => distance(a, event.clientX, event.clientY) - distance(b, event.clientX, event.clientY))[0];

const beforeAt = (event, parent, moving) => {
  let winner;
  let min = Infinity;
  for (const child of parent.children) {
    if (child === moving || child === ghost) continue;
    const box = child.getBoundingClientRect();
    const dx = event.clientX - box.left - box.width / 2;
    const dy = (event.clientY - box.top - box.height / 2) * 6;
    const current = Math.hypot(dx, dy);
    if (current < min) {
      min = current;
      winner = dy > 0 ? child.nextElementSibling : child;
    }
  }
  while (winner === moving || winner === ghost) winner = winner.nextElementSibling;
  return winner;
};

const moveEffect = el => {
  const clone = el.cloneNode(true);
  const opacity = el.style.opacity;
  document.body.append(clone);
  const from = clone.getBoundingClientRect();
  Object.assign(clone.style, {
    position: "fixed", left: `${from.left}px`, top: `${from.top}px`, width: `${from.width}px`, height: `${from.height}px`,
    maxWidth: "none", minWidth: "0", maxHeight: "none", minHeight: "0", pointerEvents: "none",
  });
  requestAnimationFrame(() => {
    const to = el.getBoundingClientRect();
    el.style.opacity = "0";
    Object.assign(clone.style, {
      transition: "all 190ms", left: `${to.left}px`, top: `${to.top}px`, width: `${to.width}px`, height: `${to.height}px`,
    });
    setTimeout(() => {
      clone.style.opacity = "0";
      setTimeout(() => {
        clone.remove();
        el.style.opacity = opacity;
      }, 100);
    }, 190);
  });
};

export function contentDrag({ onChange, onStart, onStop }) {
  let active;
  let before;
  let frame;
  let parent;
  let original;
  let style;
  let targets = [];

  const position = event => {
    frame = null;
    if (!active) return;
    active.style.left = `${event.clientX - 40}px`;
    active.style.top = `${event.clientY + 20}px`;
    const nextParent = nearest(event, targets, active);
    if (!nextParent) return;
    const nextBefore = beforeAt(event, nextParent, active);
    if (parent === nextParent && before === nextBefore) return;
    parent = nextParent;
    before = nextBefore;
    parent.insertBefore(ghost, before);
    onChange?.({ before, parent });
  };
  const move = event => {
    if (frame) return;
    frame = requestAnimationFrame(() => position(event));
  };
  const end = () => {
    document.removeEventListener("mousemove", move);
    document.removeEventListener("mouseup", end);
    cancelAnimationFrame(frame);
    frame = null;
    if (!active) return;
    const el = active;
    const target = parent;
    const next = before;
    if (target) {
      moveEffect(el);
      ghost.remove();
      target.insertBefore(el, next);
      el.style.cssText = style;
    } else {
      original.parent.insertBefore(el, original.next);
      el.style.cssText = style;
    }
    active = parent = before = null;
    onStop?.({ before: next, el, original, parent: target });
  };

  return {
    get moving() { return active; },
    set targets(value) { targets = value; },
    start(el, event) {
      if (active) return;
      const box = el.getBoundingClientRect();
      active = el;
      original = { parent: el.parentNode, next: el.nextSibling };
      style = el.style.cssText;
      onStart?.({ el });
      Object.assign(el.style, { position: "fixed", left: `${box.left}px`, top: `${box.top}px`, zIndex: 2147483644 });
      document.body.append(el);
      document.addEventListener("mousemove", move);
      document.addEventListener("mouseup", end);
      if (event) position(event);
    },
  };
}
