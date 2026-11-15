import { api } from "@qino/pub/api.js";

/**
 * The fin backend pages' actions: post to the node api, say what came back in a u2 dialog, then
 * reload — the pages are small, and filters live in the URL, so nothing is lost. An answer with a
 * `url` goes there instead; one that asks (`ask`) posts `then` on yes.
 */
export function finPanel(el) {
  const node = api.cms.node(Number(cms.el.nid(el)));
  const dialog = () => import("@qino/u2/js/dialog/dialog.js");
  /** The named fields of a form, trimmed; a checkbox counts only when checked. */
  const fields = (form) => Object.fromEntries([...form.elements].filter((e) => e.name)
    .map((e) => [e.name, e.type === "checkbox" ? (e.checked ? e.value : "") : e.value.trim()]));
  const execute = async (button, data) => {
    if (button) button.disabled = true;
    try {
      const response = await node.api.post(data);
      // what was done stands, whatever the follow-up does: the page shows it again either way
      if (response?.ask) {
        if (await (await dialog()).confirm(response.ask)) await execute(button, response.then);
      } else if (response?.message) await (await dialog()).alert(response.message);
      // an action that made something new goes there, any other shows the page again
      if (response?.url) location.href = response.url;
      else if (response?.ok !== false) location.reload();
    } catch (e) {
      await (await dialog()).alert(e?.message || String(e));
    } finally {
      if (button) button.disabled = false;
    }
  };
  /** The chosen files of an input, as they go to the node api: name, type and content in base64. */
  const files = (input) => Promise.all([...input.files].map(async (file) => ({
    name: file.name,
    type: file.type,
    data: new Uint8Array(await file.arrayBuffer()).toBase64(),
  })));
  /** A GET filter form that applies itself as one types: debounced, the page is fetched at the new URL
   *  and only `list` is swapped, so focus and caret stay; the address bar follows. */
  const filter = (form, list) => {
    let timer, ctrl;
    const load = async () => {
      const url = new URL(form.action);
      url.search = new URLSearchParams([...new FormData(form)].filter(([, v]) => v));
      ctrl?.abort();
      ctrl = new AbortController();
      const text = await fetch(url, { signal: ctrl.signal }).then((r) => r.text(), () => null);
      if (text == null) return; // aborted by a newer one
      const fresh = new DOMParser().parseFromString(text, "text/html")
        .querySelector(`[qcms-id="${cms.el.nid(el)}"] [data-list]`);
      if (!fresh) return void (location.href = url);
      list.innerHTML = fresh.innerHTML;
      history.replaceState(history.state, "", url);
    };
    form.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(load, 300); });
    form.addEventListener("submit", (e) => { e.preventDefault(); clearTimeout(timer); load(); });
  };
  return { node, execute, fields, files, filter };
}
