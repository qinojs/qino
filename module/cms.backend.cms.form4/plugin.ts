import { html } from "@qino/qino";
import { backend } from "@qino/qino/cms.backend";

import api from "./nodeApi.ts";
import { formLine, formOfVars, forms, list } from "./render.ts";
import manifest from "./manifest.json" with { type: "json" };

import type { App, HtmlString } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

const { name } = manifest;

export async function install({ app }: { app: App }): Promise<void> {
  await backend.install(app, name, {
    en: "Form entries",
    de: "Formular-Einträge",
    fr: "Entrées de formulaire",
    it: "Voci dei moduli",
  });
}

export async function uninstall({ app }: { app: App }): Promise<void> {
  await backend.uninstall(app, name);
}

/* What came in through the forms of this site. The forms are found by their module, not by a
   list someone maintains — a form that is built today shows up here without being announced.
   Which of them a user sees is the form's own right: reading entries is reading a form. */
async function render(node: Node, { vars = {} }: { vars?: Record<string, unknown> } = {}): Promise<HtmlString> {
  const app = node.app;
  const { t } = app;
  const all = await forms(app);
  const active = await formOfVars(app, vars);

  if (!all.length) {
    return html.async`<div class=u2-card>
      <div class=-head>${t`Form entries`}</div>
      <div>${t`No form on this site keeps its entries yet.`}</div>
    </div>`;
  }

  return html.async`<div class=u2-flex>
    <div class=u2-card style="flex-grow:0">
        <div class=-head>${t`Forms`}</div>
        <table class=u2-table>${all.map((form) => formLine(app, form, form.id === active?.id))}</table>
    </div>

    <div class=u2-card>
        <div class=-head>${t`Entries`}</div>
        <div class=u2-flex>
            <input type=search data-search placeholder="${t`Search`}…">
            <button data-export>${t`Export as CSV`}</button>
        </div>
        <table class=u2-table cms-part=list>${await list(node, { vars })}</table>
    </div>
</div>`;
}

export const cms = {
  node: {
    js: ["pub/main.js"],
    render,
    parts: { list },
    api,
  },
};
