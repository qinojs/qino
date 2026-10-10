import { cms } from "@qino/qino/cms";
import { adopt, before, link, moduleLink, page, prose, section, title, todo } from "@qino/qino/starter.cms";

import manifest from "./manifest.json" with { type: "json" };

import type { App } from "@qino/qino";
import type { Node } from "@qino/qino/cms";

const { name } = manifest;

export function install({ app }: { app: App }): Promise<void> {
  return app.db.transaction(() => build(app));
}

async function build(app: App) {
  await adopt(app, name);
  const cm = cms(app);
  const root = await cm.node(1);
  // in the menu: Shop, Cart, then the contact page of starter.cms
  const shown = { access: 1, visible: true, searchable: true };

  const cart = await page(root, "cart", { en: "Cart", de: "Warenkorb", fr: "Panier", it: "Carrello" },
    { ...shown, searchable: false }, async (p) => {
      await before(p, "contact");
      await prose(p, { en: "<h1>Cart</h1>", de: "<h1>Warenkorb</h1>", fr: "<h1>Panier</h1>", it: "<h1>Carrello</h1>" });
      await section(p, "cms.cont.shp3.order.cart1");
      const to = await checkout(p);
      await prose(p, Object.fromEntries(Object.entries({
        en: "Continue to checkout", de: "Weiter zur Kasse", fr: "Passer la commande", it: "Procedi alla cassa",
      }).map(([lang, label]) => [lang, `<p>${link(to, label + " →")}</p>`])));
    });
  await checkout(cart);

  await page(root, "shop", { en: "Shop", de: "Shop", fr: "Boutique", it: "Negozio" }, shown, async (p) => {
    await before(p, "cart");
    await prose(p, {
      en: "<h1>Shop</h1>\n<p>These products are examples — change them in the backend under <i>Shop</i>.</p>",
      de: "<h1>Shop</h1>\n<p>Diese Produkte sind Beispiele — ändern Sie sie im Backend unter <i>Shop</i>.</p>",
      fr: "<h1>Boutique</h1>\n<p>Ces produits sont des exemples — modifiez-les dans le backend sous <i>Shop</i>.</p>",
      it: "<h1>Negozio</h1>\n<p>Questi prodotti sono esempi — modificateli nel backend sotto <i>Shop</i>.</p>",
    });
    const small = await section(p, "cms.cont.shp3.order.cart.small");
    await small.settings.cart_page(cart.id);
    // Products are contents of the category, as in the PHP shop: each one is listed with its own
    // add-to-cart form. A product as page of its own is not rendered in a layout.
    const category = await section(p, "cms.cont.shp3.category1");
    for (const [i, price] of [19, 29, 49].entries()) {
      const product = await category.createCont({ module: "cms.cont.shp3.product.default", visible: true });
      const n = i + 1;
      await title(product, {
        en: `Sample product ${n}`, de: `Beispielprodukt ${n}`, fr: `Produit exemple ${n}`, it: `Prodotto di esempio ${n}`,
      });
      await app.db.table("shp3_product").ensure({ id: product.id, price });
    }
  });

  const settings = await moduleLink(app, "cms.backend.shp3.settings", "Backend → Shop → Settings");
  const products = await moduleLink(app, "cms.backend.shp3.products", "Backend → Shop → Products");
  await todo(app, "todo-shop", {
    en: `<h2>Shop</h2>\n<p>Enter the shop's address, currencies, VAT and the countries you deliver to under ${settings}. Change the prices of the sample products or delete them under ${products}. Order confirmations need the mail server.</p>`,
    de: `<h2>Shop</h2>\n<p>Tragen Sie Adresse, Währungen, MWST und die Lieferländer des Shops unter ${settings} ein. Preise der Beispielprodukte ändern oder sie löschen können Sie unter ${products}. Bestellbestätigungen brauchen den Mailserver.</p>`,
    fr: `<h2>Boutique</h2>\n<p>Indiquez l'adresse, les devises, la TVA et les pays de livraison sous ${settings}. Modifiez les prix des produits exemples ou supprimez-les sous ${products}. Les confirmations de commande nécessitent le serveur de messagerie.</p>`,
    it: `<h2>Negozio</h2>\n<p>Inserite indirizzo, valute, IVA e paesi di consegna sotto ${settings}. Modificate i prezzi dei prodotti di esempio o eliminateli sotto ${products}. Le conferme d'ordine richiedono il server di posta.</p>`,
  });
}

/** Checkout below the cart, and the thank-you page cms.cont.shp3.order.buy1 leads to: its first child. */
async function checkout(cart: Node) {
  const p = await page(cart, "checkout", { en: "Checkout", de: "Kasse", fr: "Commande", it: "Cassa" },
    { access: 1, visible: false, searchable: false }, async (p) => {
      await prose(p, {
        en: "<h1>Checkout</h1>\n<p>Where should it go, and how would you like to pay?</p>",
        de: "<h1>Kasse</h1>\n<p>Wohin soll die Bestellung, und wie möchten Sie bezahlen?</p>",
        fr: "<h1>Commande</h1>\n<p>Où devons-nous livrer, et comment souhaitez-vous payer ?</p>",
        it: "<h1>Cassa</h1>\n<p>Dove dobbiamo consegnare, e come desiderate pagare?</p>",
      });
      for (const step of ["addresses2", "shipping", "payment", "buy1"]) await section(p, `cms.cont.shp3.order.${step}`);
    });
  await page(p, "order-placed", { en: "Thank you", de: "Vielen Dank", fr: "Merci", it: "Grazie" },
    { access: 1, visible: false, searchable: false }, (p) => prose(p, {
      en: "<h1>Thank you for your order</h1>\n<p>You will receive a confirmation by email.</p>",
      de: "<h1>Vielen Dank für Ihre Bestellung</h1>\n<p>Sie erhalten eine Bestätigung per E-Mail.</p>",
      fr: "<h1>Merci pour votre commande</h1>\n<p>Vous recevrez une confirmation par e-mail.</p>",
      it: "<h1>Grazie per il vostro ordine</h1>\n<p>Riceverete una conferma via e-mail.</p>",
    }));
  return p;
}
