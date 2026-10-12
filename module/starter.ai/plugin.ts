import { adopt, moduleLink, todo } from "@qino/qino/starter.cms";

import manifest from "./manifest.json" with { type: "json" };

import type { App } from "@qino/qino";

// No pages: the AI modules live in the editor and the backend, whose pages they install themselves.
export async function install({ app }: { app: App }): Promise<void> {
  await adopt(app, manifest.name);
  const ai = await moduleLink(app, "cms.backend.ai", "Backend → AI");
  await todo(app, "todo-ai", { en: "AI", de: "KI", fr: "IA", it: "IA" }, {
    en: `<p>Nothing answers until a provider is set up under ${ai}: enter the API key of one, for example OpenRouter or OpenAI.</p>`,
    de: `<p>Nichts antwortet, bevor unter ${ai} ein Anbieter eingerichtet ist: Tragen Sie den API-Schlüssel eines Anbieters ein, zum Beispiel OpenRouter oder OpenAI.</p>`,
    fr: `<p>Rien ne répond tant qu'aucun fournisseur n'est configuré sous ${ai} : saisissez la clé API de l'un d'eux, par exemple OpenRouter ou OpenAI.</p>`,
    it: `<p>Nulla risponde finché non è configurato un fornitore sotto ${ai}: inserite la chiave API di uno di essi, per esempio OpenRouter o OpenAI.</p>`,
  });
}
