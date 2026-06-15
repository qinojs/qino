cms.initNode("backend.superuser.db.query", (el) => {
  const editor = el.querySelector(".-editor");
  const schema = JSON.parse(el.querySelector(".-schema").textContent);
  const vocab = [...new Set([...schema.keywords, ...schema.tables.map(t => t.name), ...schema.tables.flatMap(t => t.fields.map(f => f.name))])];

  const start = () => { if (editor.textarea && !editor._sqlReady) { editor._sqlReady = true; setup(el, editor, vocab); } };
  customElements.whenDefined("u2-code").then(start);
  start(); // in case the element is already upgraded
});

function setup(el, editor, vocab) {
  const ta = editor.textarea;

  const replaceWord = (word, replacement) => {
    const pos = ta.selectionStart, start = pos - word.length;
    ta.value = ta.value.slice(0, start) + replacement + ta.value.slice(pos);
    const np = start + replacement.length;
    ta.setSelectionRange(np, np);
    ta.dispatchEvent(new Event("input"));
    ta.focus();
  };

  const insert = (text) => {
    const s = ta.selectionStart, e = ta.selectionEnd;
    ta.value = ta.value.slice(0, s) + text + ta.value.slice(e);
    ta.setSelectionRange(s + text.length, s + text.length);
    ta.dispatchEvent(new Event("input"));
    ta.focus();
  };

  // --- helper: click table/field to insert ---
  el.addEventListener("click", (ev) => {
    const t = ev.target.closest("[data-table]"), f = ev.target.closest("[data-field]");
    if (t) insert(ta.value.trim() ? t.dataset.table : `SELECT * FROM ${t.dataset.table} LIMIT 100`);
    else if (f) insert(f.dataset.field);
  });

  // send the current editor query as context when asking the AI
  el.querySelector(".-ai")?.addEventListener("submit", () => {
    const h = el.querySelector(".-aisql");
    if (h) h.value = ta.value;
  });

  el.querySelector(".-tsearch")?.addEventListener("input", (ev) => {
    const q = ev.target.value.toLowerCase();
    el.querySelectorAll(".-table").forEach((d) =>
      d.style.display = d.querySelector(".-tname").dataset.table.toLowerCase().includes(q) ? "" : "none"
    );
  });

  // --- autocomplete ---
  const box = document.createElement("div");
  box.className = "-suggest";
  box.hidden = true;
  editor.after(box);
  let items = [], active = -1;

  const wordBefore = () => ta.value.slice(0, ta.selectionStart).match(/[A-Za-z_]\w*$/)?.[0] ?? "";

  const close = () => { box.hidden = true; items = []; active = -1; };

  const open = () => {
    const word = wordBefore();
    const low = word.toLowerCase();
    items = word ? vocab.filter(v => v.toLowerCase().startsWith(low) && v.toLowerCase() !== low).slice(0, 10) : [];
    if (!items.length) return close();
    active = 0;
    box.innerHTML = items.map((v, i) => `<button type=button class="-opt${i === 0 ? " -on" : ""}" data-i="${i}">${v}</button>`).join("");
    box.hidden = false;
    place();
  };

  // Position the dropdown at the caret (textarea lives in shadow DOM → measure via a mirror div).
  // Coords are viewport-based; convert to the offsetParent (.-console) so transforms don't break it.
  const place = () => {
    const caret = caretCoords(ta);
    const p = box.offsetParent.getBoundingClientRect();
    const overflowX = Math.max(0, caret.left + box.offsetWidth + 4 - innerWidth);
    box.style.left = (caret.left - p.left - overflowX) + "px";
    box.style.top = (caret.top - p.top) + "px";
  };

  const accept = () => { if (items[active]) replaceWord(wordBefore(), items[active]); close(); };

  ta.addEventListener("input", open);
  ta.addEventListener("blur", () => setTimeout(close, 150));
  box.addEventListener("mousedown", (ev) => { const b = ev.target.closest(".-opt"); if (b) { active = +b.dataset.i; accept(); } });

  ta.addEventListener("keydown", (ev) => {
    if (!box.hidden && items.length) {
      if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
        ev.preventDefault();
        active = (active + (ev.key === "ArrowDown" ? 1 : items.length - 1)) % items.length;
        box.querySelectorAll(".-opt").forEach((o, i) => o.classList.toggle("-on", i === active));
        return;
      }
      if (ev.key === "Enter" || ev.key === "Tab") { ev.preventDefault(); accept(); return; }
      if (ev.key === "Escape") { ev.preventDefault(); close(); return; }
    }
    if ((ev.ctrlKey || ev.metaKey) && ev.key === "Enter") editor.closest("form").requestSubmit();
  });
}

// Caret position of a textarea in viewport coords, via a hidden mirror element.
function caretCoords(ta) {
  const style = getComputedStyle(ta);
  const div = document.createElement("div");
  for (const p of ["boxSizing", "width", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft", "borderTopWidth", "borderRightWidth", "borderBottomWidth", "borderLeftWidth", "fontFamily", "fontSize", "fontWeight", "fontStyle", "letterSpacing", "lineHeight", "textTransform", "wordSpacing", "tabSize"]) div.style[p] = style[p];
  Object.assign(div.style, { position: "absolute", visibility: "hidden", whiteSpace: "pre-wrap", wordWrap: "break-word", top: "0", left: "0" });
  div.textContent = ta.value.slice(0, ta.selectionStart);
  const span = document.createElement("span");
  span.textContent = ".";
  div.appendChild(span);
  document.body.appendChild(div);
  const left = span.offsetLeft, top = span.offsetTop;
  div.remove();
  const rect = ta.getBoundingClientRect();
  const lh = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.2;
  return { left: rect.left + left - ta.scrollLeft, top: rect.top + top - ta.scrollTop + lh };
}
