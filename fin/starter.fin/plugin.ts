import { cms } from "@qino/qino/cms";
import { adopt, before, moduleLink, page, prose, section, todo } from "@qino/qino/starter.cms";

import manifest from "./manifest.json" with { type: "json" };

import type { App } from "@qino/qino";

const { name } = manifest;

export function install({ app }: { app: App }): Promise<void> {
  return app.db.transaction(() => build(app));
}

async function build(app: App) {
  await adopt(app, name);
  const modules = await moduleLink(app, "cms.backend.superuser.module", "Backend → Superuser → Modules");
  const finance = await moduleLink(app, "cms.backend.superuser.fin", "Backend → Superuser → Finance");
  await todo(app, "todo-fin", {
    en: `<h2>Invoices</h2>\n<p>Your address on the invoices comes from the identity. To get paid online, install a payment provider under ${modules}, for example <i>fin.payment.qrbill</i> or <i>fin.payment.stripe</i>. Invoices are written under ${finance}.</p>`,
    de: `<h2>Rechnungen</h2>\n<p>Ihre Adresse auf den Rechnungen kommt aus der Identität. Für Online-Zahlungen installieren Sie unter ${modules} einen Zahlungsanbieter, zum Beispiel <i>fin.payment.qrbill</i> oder <i>fin.payment.stripe</i>. Rechnungen schreiben Sie unter ${finance}.</p>`,
    fr: `<h2>Factures</h2>\n<p>Votre adresse sur les factures vient de l'identité. Pour être payé en ligne, installez un prestataire de paiement sous ${modules}, par exemple <i>fin.payment.qrbill</i> ou <i>fin.payment.stripe</i>. Les factures se rédigent sous ${finance}.</p>`,
    it: `<h2>Fatture</h2>\n<p>Il vostro indirizzo sulle fatture viene dall'identità. Per essere pagati online, installate un fornitore di pagamento sotto ${modules}, per esempio <i>fin.payment.qrbill</i> o <i>fin.payment.stripe</i>. Le fatture si scrivono sotto ${finance}.</p>`,
  });

  const account = (await cms(app).nodesByName("account")).values().find((node) => node.vs.type === "p");
  if (!account) return; // the site removed its account area; the modules stay usable from the backend
  const shown = { access: 1, visible: true, searchable: false };

  const invoices = { en: "Invoices", de: "Rechnungen", fr: "Factures", it: "Fatture" };
  // what a customer comes for, before the sign-in settings of starter.account
  await page(account, "invoices", invoices, shown, async (p) => {
    await before(p, "passkeys");
    await prose(p, {
      en: "<h1>Invoices</h1>\n<p>Your invoices, each as PDF. What is still open can be paid here.</p>",
      de: "<h1>Rechnungen</h1>\n<p>Ihre Rechnungen, jede als PDF. Was noch offen ist, bezahlen Sie hier.</p>",
      fr: "<h1>Factures</h1>\n<p>Vos factures, chacune en PDF. Ce qui reste ouvert se paie ici.</p>",
      it: "<h1>Fatture</h1>\n<p>Le vostre fatture, ognuna in PDF. Ciò che è ancora aperto si paga qui.</p>",
    });
    await section(p, "cms.cont.fin.my.invoices");
  });
  const address = { en: "Billing address", de: "Rechnungsadresse", fr: "Adresse de facturation", it: "Indirizzo di fatturazione" };
  await page(account, "address", address, shown, async (p) => {
    await before(p, "passkeys");
    await prose(p, {
      en: "<h1>Billing address</h1>\n<p>Where your invoices go.</p>",
      de: "<h1>Rechnungsadresse</h1>\n<p>Wohin Ihre Rechnungen gehen.</p>",
      fr: "<h1>Adresse de facturation</h1>\n<p>Où vos factures sont envoyées.</p>",
      it: "<h1>Indirizzo di fatturazione</h1>\n<p>Dove vengono inviate le vostre fatture.</p>",
    });
    await section(p, "cms.cont.fin.my.address");
  });
}
