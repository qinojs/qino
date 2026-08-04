import { apt } from "../../core/pub/js/qino.js";

cms.initNode("cont.shp3.order.cart1", (el) => {
  const node = apt.cms.node(Number(cms.el.nid(el)));
  const itemId = (target) => target.closest("[itemid]")?.getAttribute("itemid");
  const showTotal = (r) => { if (r?.gross) el.querySelector(".-sum").textContent = r.gross; };

  el.addEventListener("change", (e) => {
    const input = e.target.closest("input.-q");
    if (!input) return;
    const tr = input.closest("[itemid]");
    node.api.post({ quantity: itemId(input), value: input.value })
      .then((r) => { if (Number(input.value) < 1) tr.remove(); showTotal(r); });
  });

  el.addEventListener("click", (e) => {
    const button = e.target.closest(".-rem button, .-resolve");
    if (!button) return;
    const tr = button.closest("[itemid]");
    const action = button.classList.contains("-resolve") ? "resolve" : "remove";
    node.api.post({ [action]: itemId(button) }).then((r) => {
      if (!r) return;
      action === "remove" ? tr.remove() : location.reload(); // the fix may have changed prices
      showTotal(r);
    });
  });
});
