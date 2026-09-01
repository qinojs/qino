// The dialog that answers a `step_up_required`, and the form its handlers share. It knows no
// factor: each one ships a `pub/stepup.js` exporting `prove(root, factor)`, and the error says
// which module to load it from.
import { t } from "./t.js";
import { html } from "./html.js";

/** Ask for a fresh proof. Resolves true when one was given, false when the user gave up. */
export async function stepUp({ factors = [] } = {}) {
  const dialog = document.createElement("dialog");
  const labels = {
    title: await t`Please confirm it is you`,
    none: await t`This needs a fresh proof of identity, and none of your sign-in methods can give one here. Sign out and in again.`,
    cancel: await t`Cancel`,
    back: await t`Use another method`,
  };

  // No form around this: a factor brings its own, and a form inside a form is dropped by the parser.
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
      back.hidden = factors.length < 2; // nothing to go back to
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

    // Straight into the best one — it is first, and every handler waits for a click of its own.
    factors.length ? choose(factors[0]) : list();
  });

  dialog.remove();
  return proven;
}

/** The shape a step-up handler has: some fields, a confirm button, errors in an `<output>`.
 *  `check(form)` resolves true when the proof went through. The form comes back for the handler
 *  that adds something of its own. */
export async function proveForm(root, fields, check) {
  root.innerHTML = `<form>${fields}
    <button>${await t`Confirm`}</button>
    <output></output>
  </form>`;
  const form = root.querySelector("form");
  const out = form.querySelector("output");
  form.querySelector("input")?.focus();

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
