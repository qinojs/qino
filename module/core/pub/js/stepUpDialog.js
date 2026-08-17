// The dialog that answers a `step_up_required`. It knows no factor: each one ships a
// `pub/stepup.js` exporting `prove(root, factor)`, and the error says which module to load it from.
import { t } from "./t.mjs";
import { hee } from "./util/hee.mjs";

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
  dialog.innerHTML = `<h2>${hee(labels.title)}</h2>
    <div data-body></div>
    <menu><button type=button data-cancel>${hee(labels.cancel)}</button></menu>`;
  const body = dialog.querySelector("[data-body]");
  dialog.querySelector("[data-cancel]").addEventListener("click", () => dialog.close());
  document.body.append(dialog);
  dialog.showModal();

  const proven = await new Promise((resolve) => {
    dialog.addEventListener("close", () => resolve(false), { once: true }); // cancel, Esc, backdrop

    const choose = async (factor) => {
      body.replaceChildren();
      const root = document.createElement("div");
      body.append(root);
      if (factors.length > 1) {
        const back = document.createElement("button");
        back.type = "button";
        back.textContent = labels.back;
        back.addEventListener("click", list);
        body.append(back);
      }
      try {
        const { prove } = await import(`@qino/m/${factor.module}/pub/stepup.js`);
        if (await prove(root, factor)) resolve(true);
      } catch (e) {
        root.textContent = e?.message || String(e);
      }
    };

    function list() {
      body.replaceChildren();
      if (!factors.length) return void (body.textContent = labels.none);
      for (const factor of factors) {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = factor.label;
        button.addEventListener("click", () => choose(factor));
        body.append(button);
      }
    }

    factors.length === 1 ? choose(factors[0]) : list();
  });

  dialog.remove();
  return proven;
}
