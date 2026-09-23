// Dialog for `step_up_required`, plus the shared form for its handlers. Knows no factor: each has a
// `pub/stepup.js` exporting `prove(root, factor)`; the error names the module.
import { t } from "./t.js";
import { html } from "./html.js";

/** Ask for a fresh proof. Resolves true on success, false if cancelled. */
export async function stepUp({ factors = [] } = {}) {
  const dialog = document.createElement("dialog");
  const labels = {
    title: await t`Please confirm it is you`,
    none: await t`This needs a fresh proof of identity, and none of your sign-in methods can give one here. Sign out and in again.`,
    cancel: await t`Cancel`,
    back: await t`Use another method`,
  };

  // No form here: factors bring their own, and nested forms are dropped by the parser.
  dialog.innerHTML = html`<h2>${labels.title}</h2>
    <div data-body style="display:flex; flex-direction:column;"></div>
    <menu>
      <button type=button data-back hidden>${labels.back}</button>
      <button type=button data-cancel>${labels.cancel}</button>
    </menu>`;
  const body = dialog.querySelector("[data-body]");
  const back = dialog.querySelector("[data-back]");
  dialog.querySelector("[data-cancel]").addEventListener("click", () => dialog.close());
  document.body.append(dialog);
  dialog.showModal();

  const proven = await new Promise((resolve) => {
    dialog.addEventListener("close", () => resolve(false), { once: true }); // cancel, Esc, backdrop

    const list = () => {
      back.hidden = true;
      body.innerHTML = factors.length
        ? html`${factors.map((factor, i) => html`<button type=button data-pick=${i}>${factor.label}</button>`)}`
        : labels.none;
    };

    const choose = async (factor) => {
      back.hidden = factors.length < 2; // no other factor
      body.replaceChildren();
      try {
        const { prove } = await import(`@qino/m/${factor.module}/pub/stepup.js`);
        if (await prove(body, factor)) resolve(true);
      } catch (e) {
        body.textContent = e?.message || String(e);
      }
    };

    back.addEventListener("click", list);
    body.addEventListener("click", (event) => {
      const pick = event.target.closest("[data-pick]");
      if (pick) choose(factors[pick.dataset.pick]);
    });

    // Open the best (first) one directly; each handler waits for its own click.
    factors.length ? choose(factors[0]) : list();
  });

  dialog.remove();
  return proven;
}

/** Standard step-up form: fields, confirm button, errors in an `<output>`. `check(form)` resolves
 *  true on success. Returns the form, so handlers can add to it. */
export async function proveForm(root, fields, check) {
  root.innerHTML = `<form>${fields}
    <button>${await t`Confirm`}</button>
    <output></output>
  </form>`;
  const form = root.querySelector("form");
  const out = form.querySelector("output");
  form.querySelector("input")?.focus();

  // Clean pasted text instead of truncating: a leading space must not cut off the last digit.
  for (const el of form.querySelectorAll("input[name=code]")) {
    el.addEventListener("input", () => {
      el.value = el.inputMode === "numeric" ? el.value.replace(/\D/g, "").slice(0, 6) : el.value.trim();
    });
  }

  const done = new Promise((resolve) => {
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      try {
        if (await check(form)) return resolve(true);
        out.value = await t`That counted for nothing here.`;
      } catch (e) {
        out.value = e?.message || String(e);
      }
    });
  });
  return { form, done };
}
